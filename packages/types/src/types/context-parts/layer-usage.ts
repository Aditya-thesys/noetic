import type { ReanchorReason } from '../context-cache';
import type { Item } from '../items';

/** @public Per-layer contribution to the context window on the most recent LLM call. */
export interface LayerUsageEntry {
  readonly layerId: string;
  readonly tokenCount: number;
  /** Items this layer contributed to the context view for the last LLM call. */
  readonly items: ReadonlyArray<Item>;
  /** Which band the layer rendered into. */
  readonly placement: 'anchor' | 'live';
  /** `'pinned'` when the items are a replay of an earlier render, held for the prompt cache. */
  readonly served: 'fresh' | 'pinned';
  /** Whether the layer's fresh output differed from its pin, and so was superseded. */
  readonly changed: boolean;
  /** Share of watched assemblies in which this layer's output changed, 0–1. */
  readonly churnRate: number;
  /** Tokens this layer's changes would have re-billed had it not been pinned. */
  readonly rebillTokens: number;
}

/** @public Prompt-cache anchoring state behind the most recent assembly. */
export interface EpochUsage {
  readonly id: string;
  /** Assemblies served by this epoch, including the one just made. */
  readonly age: number;
  readonly anchorTokens: number;
  readonly liveTokens: number;
  readonly deltaTokens: number;
  /** Set only on an assembly that re-anchored. */
  readonly reanchorReason?: ReanchorReason;
}

/** @public Breakdown of the context window as of the most recent LLM call in an execution. */
export interface LastLayerUsage {
  readonly executionId: string;
  readonly modelId: string;
  readonly layers: ReadonlyArray<LayerUsageEntry>;
  readonly systemPromptTokens: number;
  readonly toolsTokens: number;
  readonly historyTokens: number;
  readonly totalUsedTokens: number;
  /** Absent when context caching is switched off. */
  readonly epoch?: EpochUsage;
}
