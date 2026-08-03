import type { Item } from '../types/items';

//#region Public API

/**
 * @public Hash a string to 16 hex chars (64 bits).
 *
 * Not cryptographic — it exists to answer "is this byte-identical to last
 * time?" cheaply. 64 bits keeps accidental collisions far enough away that a
 * stale-content false match is not a practical concern.
 *
 * Adapted from bryc's cyrb64 (public domain):
 * https://github.com/bryc/code/blob/master/jshash/experimental/cyrb1.js
 */
export function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * @public Hash rendered items by the content that actually reaches the model.
 *
 * `createMessage` mints a fresh `id` on every render, so hashing items verbatim
 * would report a change every turn even when the text is identical. Message
 * items are sent as `{role, content}` alone, so `id` and `status` are dropped
 * before hashing; every other item type is hashed whole, since their ids can
 * reach the wire.
 *
 * Object keys are sorted, so a layer that builds its items in a different key
 * order between renders still hashes the same.
 */
export function hashItems(items: ReadonlyArray<Item>): string {
  return hashString(stableStringify(items.map(wireShape)));
}

//#endregion

//#region Helpers

/** Drops the fields the provider adapter strips before sending a message item. */
function wireShape(item: Item): unknown {
  if (item.type !== 'message') {
    return item;
  }
  const { id: _id, status: _status, ...rest } = item;
  return rest;
}

/** `JSON.stringify` with object keys sorted at every depth. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

//#endregion
