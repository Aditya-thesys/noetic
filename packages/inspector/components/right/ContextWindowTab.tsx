'use client';

/**
 * Exactly what the next model call would receive: `previewRequestItems()`
 * output — layer recall items followed by session history. Refetches on
 * `preview_invalidated` (once per completed turn); 409s while a turn is
 * generating and shows the last good preview instead.
 */

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { idOf, roleOf, textOf } from '../../lib/items';
import { useInspector } from '../../lib/store';
import type { Item } from '../../server/wire-types';

function itemLabel(item: Item): string {
  if (item.type === 'message') {
    return item.role;
  }
  return item.type;
}

export function ContextWindowTab() {
  const _previewVersion = useInspector((state) => state.previewVersion);
  const [items, setItems] = useState<Item[] | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    api
      .preview()
      .then((preview) => {
        setItems(preview.items);
        setStale(false);
      })
      .catch(() => setStale(true));
  }, []);

  if (items === null) {
    return <p className="p-3 text-[12.5px] text-ink-3">Computing the next-turn preview…</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-3 py-2">
        <p className="text-[11.5px] text-ink-2">
          {items.length} items would be sent on the next turn
          {stale ? ' (stale — refreshes when the current turn finishes)' : ''}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items.map((item) => {
          const text = textOf(item);
          return (
            <div key={idOf(item)} className="mb-1.5 rounded-control bg-inset p-2 shadow-hairline">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="rounded-chip bg-surface px-1.5 py-px font-mono text-[10px] text-ink-2 shadow-hairline">
                  {itemLabel(item)}
                </span>
                <span className="font-mono text-[10px] text-ink-3">{roleOf(item)}</span>
              </div>
              <p className="font-mono text-[11px] leading-snug break-words whitespace-pre-wrap text-ink-2">
                {text.length > 0 ? text : JSON.stringify(item).slice(0, 400)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
