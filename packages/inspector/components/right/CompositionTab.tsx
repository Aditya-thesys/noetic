'use client';

/**
 * How the last model call's context window was spent: one labeled bar row
 * per component (system prompt, tools, each memory layer, history), lengths
 * proportional to token count. Single-hue marks with direct value labels —
 * identity lives in the row label, not color.
 */

import { useInspector } from '../../lib/store';

interface BarRow {
  id: string;
  label: string;
  tokens: number;
}

function Bar({ row, max }: { row: BarRow; max: number }) {
  const width = max > 0 ? Math.max((row.tokens / max) * 100, 0.5) : 0;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-40 shrink-0 truncate text-right text-[11.5px] text-ink-2">
        {row.label}
      </span>
      <div className="h-4 min-w-0 flex-1">
        <div
          className="h-4 rounded-[4px] bg-accent"
          style={{
            width: `${width}%`,
          }}
          role="img"
          aria-label={`${row.label}: ${row.tokens} tokens`}
        />
      </div>
      <span className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-ink">
        {row.tokens}
      </span>
    </div>
  );
}

export function CompositionTab() {
  const usage = useInspector((state) => state.usage);

  if (usage === undefined) {
    return (
      <p className="p-3 text-[12.5px] text-ink-3">
        No model call yet — the breakdown appears after the first turn.
      </p>
    );
  }

  const rows: BarRow[] = [
    {
      id: 'system',
      label: 'System prompt',
      tokens: usage.systemPromptTokens,
    },
    {
      id: 'tools',
      label: 'Tools',
      tokens: usage.toolsTokens,
    },
    ...usage.layers.map((layer) => ({
      id: `layer-${layer.layerId}`,
      label: layer.layerId,
      tokens: layer.tokenCount,
    })),
    {
      id: 'history',
      label: 'History',
      tokens: usage.historyTokens,
    },
  ];
  const max = Math.max(...rows.map((row) => row.tokens));

  return (
    <div className="h-full overflow-y-auto p-3">
      <p className="text-[11.5px] text-ink-2">
        Last call to <span className="font-mono">{usage.modelId}</span> used{' '}
        <span className="font-medium text-ink">{usage.totalUsedTokens}</span> tokens.
      </p>
      <div className="mt-2">
        {rows.map((row) => (
          <Bar key={row.id} row={row} max={max} />
        ))}
      </div>
    </div>
  );
}
