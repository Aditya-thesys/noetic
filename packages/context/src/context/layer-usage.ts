import type {
  Context,
  EpochUsage,
  LastLayerUsage,
  LayerUsageEntry,
  RecallLayerOutput,
  Tool,
} from '@noetic-tools/types';
import { estimateTokens } from '@noetic-tools/types';

/**
 * Duck-type check for a Context whose `lastLayerUsage` property is writable.
 * Avoids importing `ContextImpl` (which lives in runtime/) from the context
 * module — preserving the context → (no interpreter/runtime) boundary.
 */
type MutableLayerUsageContext = Omit<Context, 'lastLayerUsage'> & {
  lastLayerUsage: LastLayerUsage | undefined;
};

function canWriteLayerUsage(ctx: Context): ctx is MutableLayerUsageContext {
  const desc = Object.getOwnPropertyDescriptor(ctx, 'lastLayerUsage');
  if (desc === undefined) {
    return false;
  }
  return desc.writable !== false;
}

//#region Types

/** How a layer's output was banded and pinned for this assembly. */
export interface LayerServeInfo {
  placement: 'anchor' | 'live';
  served: 'fresh' | 'pinned';
  changed: boolean;
  churnRate: number;
  rebillTokens: number;
}

const SERVED_FRESH_ANCHOR: LayerServeInfo = {
  placement: 'anchor',
  served: 'fresh',
  changed: false,
  churnRate: 0,
  rebillTokens: 0,
};

interface ComputeLayerUsageParams {
  ctx: Context;
  modelId: string;
  instructions?: string;
  tools?: ReadonlyArray<Tool>;
  /**
   * Per-layer output as it was ACTUALLY served into the view — pinned replays
   * included. Passing raw recall output here would report content the model
   * never saw.
   */
  recallResults: ReadonlyArray<RecallLayerOutput>;
  /** Banding and pin status per layer id. Absent when context caching is off. */
  serveInfo?: ReadonlyMap<string, LayerServeInfo>;
  epoch?: EpochUsage;
}

//#endregion

//#region Helpers

function estimateJsonTokens(value: unknown): number {
  try {
    return estimateTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

//#endregion

//#region Public API

export function computeLayerUsage({
  ctx,
  modelId,
  instructions,
  tools,
  recallResults,
  serveInfo,
  epoch,
}: ComputeLayerUsageParams): LastLayerUsage {
  const layers: LayerUsageEntry[] = recallResults
    .map((r) => ({
      layerId: r.layerId,
      tokenCount: r.tokenCount,
      items: r.items,
      ...(serveInfo?.get(r.layerId) ?? SERVED_FRESH_ANCHOR),
    }))
    .sort((a, b) => a.layerId.localeCompare(b.layerId));

  let historyTokens = 0;
  for (const item of ctx.itemLog.items) {
    historyTokens += estimateJsonTokens(item);
  }

  const systemPromptTokens = instructions ? estimateTokens(instructions) : 0;
  const toolsTokens = tools && tools.length > 0 ? estimateJsonTokens(tools) : 0;
  const layerTotal = layers.reduce((sum, l) => sum + l.tokenCount, 0);
  const totalUsedTokens = systemPromptTokens + toolsTokens + historyTokens + layerTotal;

  return {
    executionId: ctx.id,
    modelId,
    layers,
    systemPromptTokens,
    toolsTokens,
    historyTokens,
    totalUsedTokens,
    epoch,
  };
}

/** Commit computed usage to the Context, replacing any prior snapshot. */
export function commitLayerUsage(ctx: Context, usage: LastLayerUsage): void {
  if (!canWriteLayerUsage(ctx)) {
    return;
  }
  ctx.lastLayerUsage = usage;
}

//#endregion
