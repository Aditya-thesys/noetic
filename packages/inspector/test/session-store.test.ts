import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Item } from '@noetic-tools/core';
import { createJsonlSessionStore } from '../server/session-store';

function userItem(id: string, text: string): Item {
  return {
    id,
    type: 'message',
    role: 'user',
    status: 'completed',
    content: [
      {
        type: 'input_text',
        text,
      },
    ],
  };
}

describe('createJsonlSessionStore', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'inspector-store-'));
  });

  afterEach(() => {
    rmSync(root, {
      recursive: true,
      force: true,
    });
  });

  it('round-trips items through writeItems/readItems', async () => {
    const store = createJsonlSessionStore(root);
    const items = [
      userItem('a', 'hello'),
      userItem('b', 'again'),
    ];
    await store.writeItems('thread-1', items);
    expect(await store.readItems('thread-1')).toEqual(items);
  });

  it('returns [] for a thread that was never written', async () => {
    const store = createJsonlSessionStore(root);
    expect(await store.readItems('missing')).toEqual([]);
  });

  it('rewrites wholesale — later writes replace earlier ones', async () => {
    const store = createJsonlSessionStore(root);
    await store.writeItems('t', [
      userItem('a', 'one'),
    ]);
    await store.writeItems('t', [
      userItem('a', 'one'),
      userItem('b', 'two'),
    ]);
    const items = await store.readItems('t');
    expect(items.length).toBe(2);
  });

  it('skips corrupt lines and keeps the valid ones', async () => {
    const store = createJsonlSessionStore(root);
    await store.writeItems('t', [
      userItem('a', 'ok'),
    ]);
    const file = path.join(root, 't', 'items.jsonl');
    await appendFile(file, 'this is not json\n');
    await appendFile(file, `${JSON.stringify(userItem('b', 'also ok'))}\n`);
    const items = await store.readItems('t');
    expect(items.map((item) => ('id' in item ? item.id : ''))).toEqual([
      'a',
      'b',
    ]);
  });

  it('encodes thread ids so they cannot escape the root directory', async () => {
    const store = createJsonlSessionStore(root);
    await store.writeItems('../evil', [
      userItem('a', 'x'),
    ]);
    const raw = await readFile(
      path.join(root, encodeURIComponent('../evil'), 'items.jsonl'),
      'utf8',
    );
    expect(raw.includes('"a"')).toBe(true);
  });

  it('writes an empty file for an empty item list', async () => {
    const store = createJsonlSessionStore(root);
    await mkdir(path.join(root, 't'), {
      recursive: true,
    });
    await store.writeItems('t', []);
    expect(await store.readItems('t')).toEqual([]);
  });
});
