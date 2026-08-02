'use client';

/**
 * The conversation: renders the item log as chat (user bubbles, streaming
 * assistant text with cursor, reasoning + tool calls as expandable traces)
 * and the composer. Message/bubble styling ported from the beautiful-ui
 * showcase's ChatComposer and StreamingText.
 */

import { useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import { idOf, roleOf, textOf, toolCallOf } from '../../lib/items';
import { useInspector } from '../../lib/store';
import type { StreamingItem } from '../../server/wire-types';
import { Composer } from './Composer';
import { Thinking } from './Thinking';

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end pl-14">
      <div className="rounded-xl bg-field px-3 py-1.5 text-[13px] leading-[1.4] text-ink">
        {text}
      </div>
    </div>
  );
}

function AssistantText({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <p className="text-[13px] leading-relaxed text-ink">
      {text}
      {streaming && (
        <span
          className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full bg-ink"
          style={{
            animation: 'fade-in 150ms ease-out both',
          }}
        />
      )}
    </p>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function Message({ item, all }: { item: StreamingItem; all: StreamingItem[] }) {
  const role = roleOf(item);

  if (role === 'user') {
    return <UserBubble text={textOf(item)} />;
  }
  if (role === 'assistant') {
    return <AssistantText text={textOf(item)} streaming={!item.isComplete} />;
  }
  if (role === 'reasoning') {
    const text = textOf(item);
    if (text.length === 0) {
      return null;
    }
    return (
      <Thinking
        working={!item.isComplete}
        activeLabel="Thinking"
        doneLabel="Thought"
        prose
        rows={[
          {
            id: idOf(item),
            primary: text,
          },
        ]}
      />
    );
  }
  if (role === 'tool_call') {
    const call = toolCallOf(item, all);
    if (!call) {
      return null;
    }
    const running = call.output === undefined;
    return (
      <Thinking
        working={running}
        activeLabel={`Running ${call.name}`}
        doneLabel={`Ran ${call.name}`}
        rows={[
          {
            id: `${call.callId}-args`,
            primary: call.name,
            secondary: truncate(call.args, 80),
            mono: true,
          },
          ...(call.output !== undefined
            ? [
                {
                  id: `${call.callId}-out`,
                  primary: '→',
                  secondary: truncate(call.output, 120),
                  mono: true,
                },
              ]
            : []),
        ]}
      />
    );
  }
  return null;
}

export function ChatPane() {
  const order = useInspector((state) => state.order);
  const itemsById = useInspector((state) => state.itemsById);
  const generating = useInspector((state) => state.generating);
  const host = useInspector((state) => state.host);
  const scrollRef = useRef<HTMLDivElement>(null);

  const items = order
    .map((id) => itemsById[id])
    .filter((item): item is StreamingItem => item !== undefined);

  useEffect(() => {
    if (order.length === 0) {
      return;
    }
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
    });
  }, [
    order.length,
  ]);

  const childReady = host === undefined || host.child === 'ready';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pt-2.5 pb-1"
      >
        {items.length === 0 && (
          <p className="pt-8 text-center text-[13px] text-ink-3">
            Say something to the agent defined in the Code tab.
          </p>
        )}
        {items.map((item) => (
          <Message key={idOf(item)} item={item} all={items} />
        ))}
      </div>
      {generating && (
        <div className="flex items-center gap-2 px-3 pb-1">
          <button
            type="button"
            onClick={() => void api.abort()}
            className="rounded-chip border border-line px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:bg-hover"
          >
            Stop
          </button>
        </div>
      )}
      <Composer
        onSend={(text) => void api.sendChat(text)}
        disabled={!childReady}
        placeholder={childReady ? 'Message the agent' : 'Agent is reloading…'}
      />
    </div>
  );
}
