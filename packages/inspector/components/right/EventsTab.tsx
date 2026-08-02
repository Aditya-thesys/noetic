'use client';

/**
 * Timeline of framework lifecycle events (turn/step/tool) from the agent
 * stream, newest last.
 */

import { useEffect, useRef } from 'react';
import { useInspector } from '../../lib/store';

export function EventsTab() {
  const events = useInspector((state) => state.events);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
    });
  }, []);

  if (events.length === 0) {
    return (
      <p className="p-3 text-[12.5px] text-ink-3">
        Framework events (turns, steps, tools) appear here as the agent runs.
      </p>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-2">
      {events.map(({ seq, event }) => {
        const shortType = event.type.split(':').pop() ?? event.type;
        return (
          <div key={seq} className="flex items-baseline gap-2 border-b border-line px-1.5 py-1">
            <span className="shrink-0 rounded-chip bg-inset px-1.5 py-px font-mono text-[10px] text-ink-2 shadow-hairline">
              {shortType}
            </span>
            <span className="min-w-0 truncate font-mono text-[10.5px] text-ink-3">
              {JSON.stringify(event.data)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
