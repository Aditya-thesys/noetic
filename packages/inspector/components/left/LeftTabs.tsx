'use client';

/**
 * Left pane: Chat ⇄ Code tab switch (showcase tab styling), plus the session
 * reset control. Both panes stay mounted so the editor keeps its buffer and
 * the chat keeps its scroll.
 */

import { useState } from 'react';
import { api } from '../../lib/api';
import { useInspector } from '../../lib/store';
import { ChatPane } from '../chat/ChatPane';
import { EditorPane } from './EditorPane';

const TABS = [
  'Chat',
  'Code',
] as const;
type Tab = (typeof TABS)[number];

function ResetButton() {
  const resetSession = useInspector((state) => state.resetSession);

  const reset = async (): Promise<void> => {
    const confirmed = window.confirm(
      'Reset the session? Chat history and all memory-layer state will be wiped.',
    );
    if (!confirmed) {
      return;
    }
    await api.reset();
    // Clear the UI immediately; the fresh child's ready event re-syncs the rest.
    resetSession();
  };

  return (
    <button
      type="button"
      onClick={() => void reset()}
      title="Wipe chat history and memory-layer state, restart the agent"
      className="rounded-chip border border-line px-2 py-0.5 text-[11.5px] text-ink-2 transition-colors hover:border-red/40 hover:bg-red-tint hover:text-red"
    >
      Reset
    </button>
  );
}

export function LeftTabs() {
  const [tab, setTab] = useState<Tab>('Chat');

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-card bg-surface shadow-card">
      <div className="flex shrink-0 items-center justify-between border-b border-line p-1.5">
        <div className="flex items-center">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={tab === name}
              onClick={() => setTab(name)}
              className={`rounded-[6px] px-2 py-[3px] text-[13px] text-ink transition-[background-color,opacity] duration-100 ${
                tab === name ? 'bg-field' : 'opacity-50 hover:opacity-75'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        <ResetButton />
      </div>
      <div className={`min-h-0 flex-1 ${tab === 'Chat' ? '' : 'hidden'}`}>
        <ChatPane />
      </div>
      <div className={`min-h-0 flex-1 ${tab === 'Code' ? '' : 'hidden'}`}>
        <EditorPane />
      </div>
    </div>
  );
}
