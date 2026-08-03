import type { Item } from './items';

//#region Config

/**
 * @public Tuning for the prompt-cache anchoring described on {@link LayerPlacement}.
 *
 * The defaults are chosen so that a layer set with no explicit placements still
 * gets a stable prefix without any configuration.
 */
export interface ContextCacheConfig {
  /** Master switch. Default `true`. When off, every layer renders before history, as it did before bands existed. */
  enabled?: boolean;
  /** Re-anchor when the first round reports fewer cached tokens than this. Default 100. */
  minCachedTokens?: number;
  /**
   * Assemblies an epoch must reach before its cache figures are judged. Default 2.
   * The first assembly after a re-anchor writes the cache rather than reading it,
   * so judging it immediately would re-anchor forever and never pin anything.
   */
  minEpochAssemblies?: number;
  /** Assemblies after which an epoch re-anchors regardless of cache figures. Default 50. */
  maxEpochAssemblies?: number;
  /** Re-anchor once supersedes cost more than this fraction of the anchor band. Default 0.15. */
  deltaBudgetFraction?: number;
  /** An `'auto'` layer changing at least this often moves to the live band. Default 0.5. */
  autoDemoteChurn?: number;
  /** An `'auto'` layer changing at most this often moves back to the anchor band. Default 0.2. */
  autoPromoteChurn?: number;
  /** Assemblies a layer must be watched for before its placement moves. Default 3. */
  minChurnSamples?: number;
  /** Fraction of the churn counters carried across a re-anchor. Default 0.5. */
  churnDecay?: number;
}

//#endregion

//#region Store

/** @public Why an epoch re-anchored. */
export type ReanchorReason =
  | 'cold-start'
  | 'instructions-changed'
  | 'cache-miss'
  | 'delta-pressure'
  | 'delta-overflow'
  | 'max-age';

/** @public One layer's rendered output, held byte-stable for the life of an epoch. */
export interface AnchorPin {
  layerId: string;
  /** The exact items served every assembly this epoch. */
  items: Item[];
  tokenCount: number;
  contentHash: string;
  /** The layer state as of pinning. Held by reference — see `RenderDeltaParams.prevState`. */
  state: unknown;
  slot: number;
}

/** @public How often a layer's rendered output changes, and what that costs. */
export interface LayerChurn {
  /** Assemblies in which the layer produced output. */
  observed: number;
  /** Assemblies in which its output differed from its pin. */
  changed: number;
  /** Tokens invalidated downstream by those changes, had they not been pinned. */
  rebillTokens: number;
}

/** @public One run of assemblies sharing a cacheable prompt prefix. */
export interface ContextEpoch {
  id: string;
  /** Pinned output, keyed as `${scopeKey}:${layerId}`. */
  pins: Map<string, AnchorPin>;
  /** Band chosen for each `'auto'` layer at the last boundary, same key as `pins`. */
  autoBand: Map<string, 'anchor' | 'live'>;
  /** Hash of the resolved instructions this epoch was anchored against. */
  instructionsHash: string;
  assemblies: number;
  anchorTokens: number;
  deltaTokens: number;
  /**
   * Set once the provider has shown it reports no cache figures, or has missed
   * so persistently that steering on its numbers is pointless. Suppresses the
   * cache-miss trigger; age and delta pressure still apply.
   */
  cacheBlind: boolean;
  /** Consecutive judged assemblies that came back a miss. */
  misses: number;
  lastReanchorReason: ReanchorReason;
}

/** @public Per-harness home for anchoring state, one epoch per cache lineage. */
export interface ContextCacheStore {
  /** Keyed by cache lineage — a thread at top level, an execution below it. */
  epochs: Map<string, ContextEpoch>;
  /** Churn per layer, outliving epochs so placement is not relearnt each time. */
  churn: Map<string, LayerChurn>;
  /** Re-anchors decided from a response, applied at the next assembly. */
  pendingReanchor: Map<string, ReanchorReason>;
}

//#endregion
