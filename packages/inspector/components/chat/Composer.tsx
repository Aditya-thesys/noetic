'use client';

/**
 * Chat input, visually ported from the beautiful-ui showcase's ChatComposer
 * (field styling, focus ring, arrow send button) but prop-driven.
 */

import { useState } from 'react';

export function Composer({
  onSend,
  disabled,
  placeholder,
}: {
  onSend(text: string): void;
  disabled: boolean;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const canSend = !disabled && draft.trim().length > 0;

  const send = (): void => {
    if (!canSend) {
      return;
    }
    onSend(draft.trim());
    setDraft('');
  };

  return (
    <div className="shrink-0 p-1.5">
      <label className="flex cursor-text flex-col gap-2 rounded-control border border-line bg-field p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.035)] transition-[border-color,box-shadow] duration-150 focus-within:border-line-strong">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              send();
            }
          }}
          placeholder={placeholder}
          aria-label="Chat prompt"
          className="min-h-4.5 bg-transparent text-[13px] leading-[1.4] text-ink outline-none placeholder:text-ink-3"
        />
        <div className="flex items-center justify-end">
          <button
            type="button"
            aria-label="Send"
            disabled={!canSend}
            onClick={send}
            className="flex size-7 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]"
            style={{
              background: canSend ? 'var(--ink)' : 'var(--line-strong)',
              color: canSend ? 'var(--surface)' : 'var(--ink-2)',
            }}
          >
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </label>
    </div>
  );
}
