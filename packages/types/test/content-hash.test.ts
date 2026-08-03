import { describe, expect, it } from 'bun:test';
import type { FunctionCallOutputItem, InputMessageItem, Item } from '../src/types/items';
import { hashItems, hashString } from '../src/util/content-hash';
import { createMessage } from '../src/util/message-helpers';

function toolOutput(callId: string, output: string): FunctionCallOutputItem {
  return {
    id: `fco-${callId}`,
    type: 'function_call_output',
    status: 'completed',
    callId,
    output,
  };
}

describe('hashString', () => {
  it('is stable for the same input', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
  });

  it('separates inputs that differ by one character', () => {
    expect(hashString('hello')).not.toBe(hashString('hellp'));
  });

  it('separates the empty string from whitespace', () => {
    expect(hashString('')).not.toBe(hashString(' '));
  });

  it('always returns 16 hex chars', () => {
    for (const input of [
      '',
      'a',
      'the quick brown fox',
      'x'.repeat(10_000),
    ]) {
      expect(hashString(input)).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

describe('hashItems', () => {
  // The load-bearing case: `createMessage` mints a fresh UUID per call, so
  // hashing items verbatim would report a change on every render even though
  // the provider adapter drops the id before sending.
  it('ignores the per-render id on message items', () => {
    const first = createMessage('same text', 'developer');
    const second = createMessage('same text', 'developer');

    expect(first.id).not.toBe(second.id);
    expect(
      hashItems([
        first,
      ]),
    ).toBe(
      hashItems([
        second,
      ]),
    );
  });

  it('ignores message status', () => {
    const base = createMessage('same text', 'developer');
    const inProgress: InputMessageItem = {
      ...base,
      status: 'in_progress',
    };

    expect(
      hashItems([
        base,
      ]),
    ).toBe(
      hashItems([
        inProgress,
      ]),
    );
  });

  it('separates messages whose text differs', () => {
    expect(
      hashItems([
        createMessage('a', 'developer'),
      ]),
    ).not.toBe(
      hashItems([
        createMessage('b', 'developer'),
      ]),
    );
  });

  it('separates messages whose role differs', () => {
    expect(
      hashItems([
        createMessage('a', 'developer'),
      ]),
    ).not.toBe(
      hashItems([
        createMessage('a', 'user'),
      ]),
    );
  });

  it('separates lists that differ in order', () => {
    const a = createMessage('a', 'developer');
    const b = createMessage('b', 'developer');

    expect(
      hashItems([
        a,
        b,
      ]),
    ).not.toBe(
      hashItems([
        b,
        a,
      ]),
    );
  });

  it('hashes the empty list', () => {
    expect(hashItems([])).toMatch(/^[0-9a-f]{16}$/);
  });

  // Non-message items keep their id, because it can reach the wire.
  it('keeps the id on non-message items', () => {
    const left: Item[] = [
      toolOutput('call-1', 'ok'),
    ];
    const right: Item[] = [
      {
        ...toolOutput('call-1', 'ok'),
        id: 'different',
      },
    ];

    expect(hashItems(left)).not.toBe(hashItems(right));
  });

  it('is insensitive to key order within an item', () => {
    const ordered: InputMessageItem = {
      id: 'x',
      type: 'message',
      role: 'developer',
      status: 'completed',
      content: [
        {
          type: 'input_text',
          text: 'hi',
        },
      ],
    };
    const shuffled: InputMessageItem = {
      content: [
        {
          text: 'hi',
          type: 'input_text',
        },
      ],
      status: 'completed',
      role: 'developer',
      type: 'message',
      id: 'x',
    };

    expect(
      hashItems([
        ordered,
      ]),
    ).toBe(
      hashItems([
        shuffled,
      ]),
    );
  });
});
