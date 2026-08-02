/**
 * Read helpers over the `Item` union for rendering: which side of the chat an
 * item belongs to and its display text. Content-part arrays mix known and
 * unknown part types, so text extraction filters by discriminant.
 */

import type { Item, StreamingItem } from '../server/wire-types';

export type ChatRole = 'user' | 'assistant' | 'reasoning' | 'tool_call' | 'tool_output' | 'other';

/** Stable identity for list keys. Every item kind carries an `id` except
 *  `ServerToolItem`; those fall back to a content hash, which is stable
 *  across refetches of the same log. */
export function idOf(item: Item): string {
  if ('id' in item && typeof item.id === 'string') {
    return item.id;
  }
  const json = JSON.stringify(item);
  let hash = 5381;
  for (let index = 0; index < json.length; index++) {
    hash = ((hash << 5) + hash + json.charCodeAt(index)) | 0;
  }
  return `anon-${item.type}-${hash}`;
}

export function roleOf(item: Item): ChatRole {
  if (item.type === 'message') {
    if (item.role === 'user') {
      return 'user';
    }
    return item.role === 'assistant' ? 'assistant' : 'other';
  }
  if (item.type === 'reasoning') {
    return 'reasoning';
  }
  if (item.type === 'function_call') {
    return 'tool_call';
  }
  if (item.type === 'function_call_output') {
    return 'tool_output';
  }
  return 'other';
}

function textParts(
  parts: ReadonlyArray<{
    type: string;
  }>,
  partType: string,
): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type === partType && 'text' in part && typeof part.text === 'string') {
      texts.push(part.text);
    }
  }
  return texts.join('');
}

/** Display text for message and reasoning items; '' for other kinds. */
export function textOf(item: Item): string {
  if (item.type === 'message') {
    return textParts(item.content, item.role === 'user' ? 'input_text' : 'output_text');
  }
  if (item.type === 'reasoning') {
    const body = item.content ? textParts(item.content, 'reasoning_text') : '';
    if (body.length > 0) {
      return body;
    }
    return item.summary.map((part) => part.text).join('');
  }
  return '';
}

/** Pair each tool call with its output (matched on callId), in order. */
export interface ToolCallView {
  callId: string;
  name: string;
  args: string;
  output?: string;
}

export function toolCallOf(item: Item, all: ReadonlyArray<StreamingItem>): ToolCallView | null {
  if (item.type !== 'function_call') {
    return null;
  }
  const output = all.find((it) => it.type === 'function_call_output' && it.callId === item.callId);
  return {
    callId: item.callId,
    name: item.name,
    args: item.arguments,
    output: output?.type === 'function_call_output' ? output.output : undefined,
  };
}
