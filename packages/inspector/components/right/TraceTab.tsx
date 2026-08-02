'use client';

/**
 * Span list from the harness's InMemoryExporter: llm.call / tool.call spans
 * with durations and GenAI attributes. Fetched on demand (refresh button) —
 * spans only accumulate server-side.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { WireSpan } from '../../server/wire-types';

function duration(span: WireSpan): string {
  if (span.endTime === undefined) {
    return '…';
  }
  return `${Math.max(span.endTime - span.startTime, 0)}ms`;
}

export function TraceTab() {
  const [spans, setSpans] = useState<WireSpan[]>([]);

  const refresh = useCallback((): void => {
    void api
      .trace()
      .then((trace) => setSpans(trace.spans))
      .catch(() => undefined);
  }, []);

  useEffect(refresh, [
    refresh,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11.5px] text-ink-2">{spans.length} spans this child</span>
        <button
          type="button"
          onClick={refresh}
          className="rounded-chip border border-line px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:bg-hover"
        >
          Refresh
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {spans.length === 0 && (
          <p className="p-2 text-[12.5px] text-ink-3">No spans yet — run a turn first.</p>
        )}
        {spans.map((span) => (
          <div key={span.spanId} className="border-b border-line px-1.5 py-1.5">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11.5px] font-medium text-ink">{span.name}</span>
              <span className="font-mono text-[10.5px] tabular-nums text-ink-3">
                {duration(span)}
              </span>
            </div>
            {Object.keys(span.attributes).length > 0 && (
              <p className="mt-0.5 truncate font-mono text-[10px] text-ink-3">
                {JSON.stringify(span.attributes)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
