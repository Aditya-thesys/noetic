'use client';

/**
 * Expandable trace row, ported from the showcase's ThinkingState: shimmer
 * label while working, settled label + chevron once done, rows revealed in
 * an expandable region. Used for both reasoning items and tool calls.
 */

import { useState } from 'react';

export interface TraceRow {
  id: string;
  primary: string;
  secondary?: string;
  mono?: boolean;
}

export function Thinking({
  working,
  activeLabel,
  doneLabel,
  rows,
  prose,
}: {
  working: boolean;
  activeLabel: string;
  doneLabel: string;
  rows: TraceRow[];
  /** Render row text as wrapped prose (reasoning) instead of truncated rows. */
  prose?: boolean;
}) {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const expanded = manualExpanded ?? working;

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManualExpanded(!(manualExpanded ?? working))}
        className="-mx-1.5 flex w-fit items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 hover:bg-hover-2"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill={working ? 'var(--ink-2)' : 'var(--ink-3)'}
        >
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
        </svg>
        {working ? (
          <span
            className="bg-clip-text text-[13px] font-medium whitespace-nowrap text-transparent"
            style={{
              backgroundImage:
                'linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer-text 1.4s linear infinite',
            }}
          >
            {activeLabel}
          </span>
        ) : (
          <span className="text-[13px] font-medium whitespace-nowrap text-ink-2">{doneLabel}</span>
        )}
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform duration-300"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
          }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-400"
        style={{
          gridTemplateRows: expanded ? '1fr' : '0fr',
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        <div className="overflow-hidden">
          <div className="relative mt-1 ml-[5px] pl-4">
            <span aria-hidden className="absolute top-0 bottom-2 left-[3px] w-px bg-line" />
            <div className="flex flex-col gap-1 py-1">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex min-h-7 w-full items-center gap-2 rounded-[6px] px-1.5 py-0.5 text-left"
                >
                  <span
                    className={`min-w-0 text-[12.5px] ${
                      prose
                        ? 'whitespace-normal leading-relaxed text-ink-2'
                        : 'truncate font-medium text-ink'
                    }`}
                  >
                    {row.primary}
                  </span>
                  {row.secondary !== undefined && (
                    <span
                      className={`shrink-0 text-[11.5px] text-ink-3 ${row.mono ? 'font-mono' : ''}`}
                    >
                      {row.secondary}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
