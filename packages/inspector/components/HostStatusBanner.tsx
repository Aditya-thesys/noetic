'use client';

/**
 * Slim banner over the whole app while the agent child is away: reloading
 * after a code save, or failed to boot (with a pointer to the Code tab).
 */

import { useInspector } from '../lib/store';

export function HostStatusBanner() {
  const host = useInspector((state) => state.host);
  if (host === undefined || host.child === 'ready') {
    return null;
  }

  const failed = host.child === 'error';
  return (
    <div
      className={`flex shrink-0 items-center gap-2 px-3 py-1 text-[12px] ${
        failed ? 'bg-red-tint text-red' : 'bg-accent-tint text-accent-ink'
      }`}
    >
      {!failed && (
        <span
          className="size-3 rounded-full border-[1.5px] border-line-strong border-t-ink-2"
          style={{
            animation: 'spin 700ms linear infinite',
          }}
        />
      )}
      {failed
        ? 'Agent failed to start — see the error in the Code tab.'
        : 'Reloading agent with your latest code…'}
    </div>
  );
}
