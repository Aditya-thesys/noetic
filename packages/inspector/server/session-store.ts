/**
 * JSONL-backed chat history, one file per thread. This is what makes a session
 * survive an agent-code hot reload: after every turn the child rewrites the
 * file from the harness's full item log (`HarnessResponse.items` — the only
 * source that includes user messages in canonical order; the item stream
 * carries model output only), and the next child revision seeds from it.
 */

import { mkdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Item } from '@noetic-tools/core';

export interface SessionStore {
  readItems(threadId: string): Promise<Item[]>;
  writeItems(threadId: string, items: ReadonlyArray<Item>): Promise<void>;
}

// Same identity coercion `platform-node/file-storage.ts` uses at its
// JSON.parse boundary: persisted lines were written from `Item` values and
// there is no schema here to re-validate against.
function itemCast(value: unknown): Item {
  // @ts-expect-error — identity coercion at the JSON.parse boundary
  return value;
}

export function createJsonlSessionStore(root: string): SessionStore {
  // Writes are chained so overlapping turn completions can never interleave.
  let chain: Promise<void> = Promise.resolve();

  function fileFor(threadId: string): string {
    return path.join(root, encodeURIComponent(threadId), 'items.jsonl');
  }

  return {
    async readItems(threadId: string): Promise<Item[]> {
      let raw: string;
      try {
        raw = await readFile(fileFor(threadId), 'utf8');
      } catch {
        return [];
      }
      const items: Item[] = [];
      for (const line of raw.split('\n')) {
        if (line.trim().length === 0) {
          continue;
        }
        try {
          items.push(itemCast(JSON.parse(line)));
        } catch {
          console.warn(`[inspector] skipping corrupt history line in ${fileFor(threadId)}`);
        }
      }
      return items;
    },

    writeItems(threadId: string, items: ReadonlyArray<Item>): Promise<void> {
      chain = chain.then(async () => {
        const file = fileFor(threadId);
        mkdirSync(path.dirname(file), {
          recursive: true,
        });
        const body = items.map((item) => JSON.stringify(item)).join('\n');
        // tmp + rename, same crash-safety pattern as platform-node's file storage.
        const tmp = `${file}.tmp`;
        await writeFile(tmp, body.length > 0 ? `${body}\n` : '');
        await rename(tmp, file);
      });
      return chain;
    },
  };
}
