'use client';

/**
 * The agent process's console: every stdout/stderr line the child writes,
 * captured by the host — so output is still here after the agent code throws
 * or the child dies. `info` lines are host markers (starts, resets, failures).
 */

import { useEffect, useRef } from 'react';
import { useInspector } from '../../lib/store';
import type { ConsoleLine } from '../../server/wire-types';

function lineClass(stream: ConsoleLine['stream']): string {
  if (stream === 'stderr') {
    return 'text-red';
  }
  if (stream === 'info') {
    return 'text-ink-3 italic';
  }
  return 'text-ink-2';
}

export function ConsoleTab() {
  const lines = useInspector((state) => state.consoleLines);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lines.length === 0) {
      return;
    }
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
    });
  }, [
    lines.length,
  ]);

  if (lines.length === 0) {
    return (
      <p className="p-3 text-[12.5px] text-ink-3">
        Agent process output (console.log, errors, crashes) appears here.
      </p>
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-inset p-2">
      {lines.map((line) => (
        <div key={line.seq} className="flex items-baseline gap-2 px-1 py-px">
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-3">
            {new Date(line.at).toLocaleTimeString()}
          </span>
          <span
            className={`min-w-0 font-mono text-[11px] leading-snug break-words whitespace-pre-wrap ${lineClass(line.stream)}`}
          >
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
}
