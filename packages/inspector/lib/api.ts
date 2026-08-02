/**
 * Typed fetch client for the inspector host (and, through its proxy, the
 * agent child). All calls go to the host — the browser never talks to the
 * child directly, so a mid-restart child just means a 503 the UI can show.
 */

import type {
  CodeResponse,
  ConsoleLine,
  HarnessStatus,
  HostEvent,
  Item,
  LastLayerUsage,
  LayerInfo,
  LayerStateResult,
  WireSpan,
} from '../server/wire-types';

export const HOST = process.env.NEXT_PUBLIC_INSPECTOR_HOST ?? 'http://localhost:4700';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${HOST}${path}`);
  if (!response.ok) {
    throw new Error(`${path} → ${response.status}`);
  }
  return response.json();
}

export const api = {
  code: (): Promise<CodeResponse> => getJson('/api/code'),

  async saveCode(source: string): Promise<void> {
    const response = await fetch(`${HOST}/api/code`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        source,
      }),
    });
    if (!response.ok) {
      throw new Error(`save failed → ${response.status}`);
    }
  },

  hostStatus: (): Promise<HostEvent> => getJson('/api/host/status'),

  /** The editor's virtual node_modules: path → file content. */
  typeLibs: (): Promise<{
    files: Record<string, string>;
  }> => getJson('/api/types'),

  consoleLines: (): Promise<{
    lines: ConsoleLine[];
  }> => getJson('/api/console'),

  reset: (): Promise<Response> =>
    fetch(`${HOST}/api/reset`, {
      method: 'POST',
    }),

  async sendChat(text: string, deliveryMode?: string): Promise<void> {
    const response = await fetch(`${HOST}/api/agent/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text,
        messageId: `msg-${crypto.randomUUID()}`,
        deliveryMode,
      }),
    });
    if (!response.ok) {
      throw new Error(`send failed → ${response.status}`);
    }
  },

  abort: (): Promise<Response> =>
    fetch(`${HOST}/api/agent/abort`, {
      method: 'POST',
    }),

  status: (): Promise<HarnessStatus> => getJson('/api/agent/status'),
  history: (): Promise<{
    items: Item[];
  }> => getJson('/api/agent/history'),
  layers: (): Promise<LayerInfo[]> => getJson('/api/agent/layers'),
  /** `version` is the store's per-layer change counter — passed as a
   *  cache-buster so each layer_state bump forces a fresh read. */
  layerState: (id: string, version: number): Promise<LayerStateResult> =>
    getJson(`/api/agent/layers/${encodeURIComponent(id)}/state?v=${version}`),
  preview: (): Promise<{
    items: Item[];
  }> => getJson('/api/agent/preview'),
  usage: (): Promise<LastLayerUsage> => getJson('/api/agent/usage'),
  trace: (): Promise<{
    spans: WireSpan[];
  }> => getJson('/api/agent/trace'),
};
