/**
 * Browser deployment target. Serves the pre-built browser bundle over
 * `http://localhost` (so OpenRouter sees a real, secure-context origin rather
 * than a `file://`/`null` origin) and drives a headless Chromium page through
 * Playwright. The page runs the smoke entirely in the browser — including the
 * live OpenRouter `fetch` — and the harness reads the structured result back.
 *
 * Run from `compat/`: `bun run smoke:browser` (after `build:bundles`).
 */

import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { formatFailure, formatSuccess } from '../../shared/report.js';
import type { SmokeResult } from '../../shared/types.js';
import { Runtime } from '../../shared/types.js';

const BUNDLE_PATH = fileURLToPath(new URL('../../dist/browser/bundle.js', import.meta.url));

/** Permissive CORS headers the proxy adds so the in-page fetch is accepted. */
const PROXY_CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': '*',
  'access-control-allow-headers': '*',
};

/** Browser-set headers that describe the page's connection, not the upstream call. */
const DROPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'origin',
  'referer',
]);

/** Response headers that describe the upstream framing of an already-decoded body. */
const DROPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'set-cookie',
]);

function forwardableRequestHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !DROPPED_REQUEST_HEADERS.has(name.toLowerCase())),
  );
}

function forwardableResponseHeaders(headers: Headers): Record<string, string> {
  const forwarded: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      forwarded[name] = value;
    }
  });
  return forwarded;
}

const PAGE_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>noetic compat browser smoke</title></head>
  <body>
    <script type="module" src="/bundle.js"></script>
  </body>
</html>`;

interface SmokeState {
  status: 'pending' | 'ok' | 'error';
  result?: SmokeResult;
  error?: string;
}

function isSmokeState(value: unknown): value is SmokeState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    typeof value.status === 'string'
  );
}

async function serveBundle(bundle: string): Promise<{
  origin: string;
  stop: () => void;
}> {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/bundle.js') {
        return new Response(bundle, {
          headers: {
            'content-type': 'text/javascript; charset=utf-8',
          },
        });
      }
      return new Response(PAGE_HTML, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      });
    },
  });
  return {
    origin: `http://localhost:${server.port}`,
    stop: () => server.stop(true),
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error(formatFailure(Runtime.Browser, 'OPENROUTER_API_KEY is not set'));
    process.exitCode = 1;
    return;
  }

  const model = process.env.NOETIC_COMPAT_MODEL ?? null;
  const bundle = await readFile(BUNDLE_PATH, 'utf8');
  const { origin, stop } = await serveBundle(bundle);
  const browser = await chromium.launch({
    headless: true,
  });

  try {
    const page = await browser.newPage();

    // OpenRouter's CORS policy rejects the SDK's custom `x-openrouter-callmodel`
    // header on preflight, so a browser cannot call it directly — real browser
    // apps proxy LLM calls through their own backend. This handler stands in for
    // that proxy: it forwards the request from this process (no CORS) and returns
    // the response with permissive CORS headers, so the in-page noetic code runs
    // unmodified. This proves core + code-agent load and execute in the browser.
    //
    // The forward deliberately does NOT use Playwright's own `route.fetch()`:
    // playwright-core 1.50's server-side fetch parses `set-cookie` against the
    // response URL, and OpenRouter's response reaches it as a bare path, so
    // `new URL('/api/v1/responses')` throws ERR_INVALID_URL. The route then
    // never fulfills, the in-page fetch hangs, and the smoke times out after
    // 60s — which is how this target had been failing.
    await page.route('https://openrouter.ai/**', async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: PROXY_CORS_HEADERS,
        });
        return;
      }
      const upstream = await fetch(request.url(), {
        method: request.method(),
        headers: forwardableRequestHeaders(await request.allHeaders()),
        body: request.postDataBuffer() ?? undefined,
      });
      // `fetch` already decoded the body, so the upstream framing headers would
      // describe it wrongly; Chromium rejects the response if they survive.
      await route.fulfill({
        status: upstream.status,
        headers: {
          ...forwardableResponseHeaders(upstream.headers),
          ...PROXY_CORS_HEADERS,
        },
        body: Buffer.from(await upstream.arrayBuffer()),
      });
    });

    await page.addInitScript(
      ([key, modelId]) => {
        window.__OPENROUTER_API_KEY__ = key;
        if (modelId) {
          window.__NOETIC_COMPAT_MODEL__ = modelId;
        }
      },
      [
        apiKey,
        model,
      ],
    );

    await page.goto(origin, {
      waitUntil: 'load',
    });
    await page.waitForFunction(
      () => window.__noeticSmoke && window.__noeticSmoke.status !== 'pending',
      undefined,
      {
        timeout: 60_000,
      },
    );

    const state = await page.evaluate(() => window.__noeticSmoke);
    if (!isSmokeState(state)) {
      throw new Error('browser did not report a smoke result');
    }
    if (state.status === 'error' || !state.result) {
      throw new Error(state.error ?? 'unknown browser smoke error');
    }

    console.log(JSON.stringify(state.result));
    console.log(formatSuccess(state.result));
  } catch (error) {
    console.error(formatFailure(Runtime.Browser, error));
    process.exitCode = 1;
  } finally {
    await browser.close();
    stop();
  }
}

await main();
