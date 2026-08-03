import type { Item, ProjectionPolicy } from '@noetic-tools/types';
import { estimateTokens } from '@noetic-tools/types';
import { stripUnresolvedToolCalls } from './strip-unresolved';

//#region Types

interface AssembleViewParams {
  systemPromptItems: Item[];
  /** Anchor band — layer output rendered before history, where a prompt cache can hold it. */
  layerOutputItems: Item[];
  historyItems: Item[];
  /** Live band — layer output rendered after history, slot-ascending. */
  liveLayerItems?: Item[];
  /** Supersedes for anchored layers whose pinned output went stale. */
  deltaItems?: Item[];
  /** Items that must land last, after everything else. Never dropped. */
  tailItems?: Item[];
  policy?: ProjectionPolicy;
}

//#endregion

//#region Helpers

/** Conservative per-item token estimate (serialized form ⇒ never under-counts). */
function itemTokens(item: Item): number {
  return estimateTokens(JSON.stringify(item));
}

function totalTokens(items: ReadonlyArray<Item>): number {
  let total = 0;
  for (const item of items) {
    total += itemTokens(item);
  }
  return total;
}

/**
 * Keep items from a slot-ascending list within `budget`, considering items in
 * slot order and dropping each non-fitting item INDIVIDUALLY. Layer-output
 * items are independent contributions (no contiguity requirement, unlike
 * history), so an oversized low-slot item must not evict later items that
 * still fit — lower-slot output gets first claim on the budget, and
 * higher-slot output is dropped first when space runs out.
 */
function keepFrontWithinBudget(items: ReadonlyArray<Item>, budget: number): Item[] {
  const kept: Item[] = [];
  let used = 0;
  for (const item of items) {
    const cost = itemTokens(item);
    if (used + cost > budget) {
      continue;
    }
    kept.push(item);
    used += cost;
  }
  return kept;
}

/**
 * Keep the MOST RECENT history items within `budget`, then strip any orphan
 * tool calls/outputs left dangling at the slice boundary. An optional
 * `windowSize` caps item count first (sliding-window overflow mode).
 */
function keepRecentWithinBudget(
  items: ReadonlyArray<Item>,
  budget: number,
  windowSize?: number,
): Item[] {
  const windowed = windowSize ? items.slice(-windowSize) : items;
  const kept: Item[] = [];
  let used = 0;
  for (let i = windowed.length - 1; i >= 0; i--) {
    const item = windowed[i];
    const cost = itemTokens(item);
    if (used + cost > budget) {
      break;
    }
    kept.unshift(item);
    used += cost;
  }
  return stripUnresolvedToolCalls(kept);
}

//#endregion

//#region Public API

/**
 * Assemble the model's context window in bands:
 *
 * ```
 * system | anchor layers | history | live layers | supersedes | tail
 * ```
 *
 * The split exists for the prompt cache, which matches on a prefix. Stable
 * layer output sits ahead of history where it can be cached; volatile output
 * sits after it, where re-rendering costs almost nothing. Both bands arrive
 * slot-ascending.
 *
 * Without a `policy` the bands are concatenated as-is (optionally sliding the
 * history window by `windowSize`). With a `policy` the view is held to a hard
 * token budget, claimed in this order: system items, then anchor output, then
 * live output, then supersedes, then the tail — with history taking whatever
 * remains and keeping the most recent turns.
 *
 * Supersedes are claimed ahead of history, and all together or not at all: a
 * dropped supersede would leave the model reading a pinned block the runtime
 * knows is stale. The caller re-anchors instead — see `prepareBandedView`.
 */
export function assembleView({
  systemPromptItems,
  layerOutputItems,
  historyItems,
  liveLayerItems = [],
  deltaItems = [],
  tailItems = [],
  policy,
}: AssembleViewParams): Item[] {
  if (!policy) {
    return [
      ...systemPromptItems,
      ...layerOutputItems,
      ...historyItems,
      ...liveLayerItems,
      ...deltaItems,
      ...tailItems,
    ];
  }

  const budget = Math.max(0, policy.tokenBudget - policy.responseReserve);
  // System items are never dropped — they anchor the conversation.
  let left = Math.max(0, budget - totalTokens(systemPromptItems));

  const keptAnchor = keepFrontWithinBudget(layerOutputItems, left);
  left = Math.max(0, left - totalTokens(keptAnchor));

  const keptLive = keepFrontWithinBudget(liveLayerItems, left);
  left = Math.max(0, left - totalTokens(keptLive));

  // The tail carries steering guidance, which must reach the model whatever the
  // budget says — it is the correction the retry exists to deliver.
  left = Math.max(0, left - totalTokens(tailItems));

  // Supersedes are never dropped either. Each one corrects a pinned block that
  // is already in the view, so dropping one leaves the model reading content
  // the runtime knows is stale — silent corruption, and far worse than losing
  // a turn of history. History absorbs the cost; `deltaBudgetFraction` keeps
  // the supersedes from growing large enough for that to hurt.
  left = Math.max(0, left - totalTokens(deltaItems));

  const keptHistory = keepRecentWithinBudget(historyItems, left, policy.windowSize);

  return [
    ...systemPromptItems,
    ...keptAnchor,
    ...keptHistory,
    ...keptLive,
    ...deltaItems,
    ...tailItems,
  ];
}

//#endregion
