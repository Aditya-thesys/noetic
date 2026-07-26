/**
 * The step completion ledger: what a resumed execution replays instead of re-running.
 *
 * The frontier records which steps were IN FLIGHT at snapshot time; it says nothing
 * about which ones finished, and a finished step leaves no trace once `leaveStep` pops
 * it. Resume therefore needs a separate record — and it must carry each step's OUTPUT,
 * not merely a "done" flag: steps consume the previous step's value, and an `llm` step
 * re-run to catch up produces a different one than the rest of the run already saw.
 *
 * Entries are stored one key per step so appends are O(1). Folding the whole ledger
 * into the single `execution:<id>:snapshot` key would rewrite a growing blob on every
 * step — O(n²) bytes over a run.
 */

import type { StorageAdapter } from '@noetic-tools/memory';
import { z } from 'zod';

/** @public One completed step, keyed by its execution path. */
export const StepLedgerEntrySchema = z.object({
  /** Execution path key — see `ContextImpl.currentPath()`. Unique per dispatch. */
  path: z.string().min(1),
  stepId: z.string(),
  kind: z.string(),
  /** Replayed verbatim in place of re-running the step. */
  output: z.unknown(),
  completedAt: z.string(),
});

/** @public A completed step recorded for replay. */
export type StepLedgerEntry = z.infer<typeof StepLedgerEntrySchema>;

/** Storage key prefix owning every ledger entry for one execution. */
export function stepLedgerPrefix(executionId: string): string {
  return `execution:${executionId}:ledger:`;
}

/**
 * @public
 * Durable append-only ledger for one harness's executions. Backed by the same
 * `StorageAdapter` as the checkpoint store; it reserves the `:ledger:` suffix that
 * `CheckpointKeys` already sets aside.
 */
export interface StepLedgerStore {
  /** Record a completed step. Sequence numbers order entries within an execution. */
  append: (executionId: string, seq: number, entry: StepLedgerEntry) => Promise<void>;
  /** Every recorded entry for an execution, keyed by path. Corrupt rows are skipped. */
  load: (executionId: string) => Promise<Map<string, StepLedgerEntry>>;
  /** Drop an execution's ledger (paired with `CheckpointStore.clear`). */
  clear: (executionId: string) => Promise<void>;
}

/** Zero-pad so lexicographic key order matches dispatch order under `list()`. */
function seqKey(executionId: string, seq: number): string {
  return `${stepLedgerPrefix(executionId)}${String(seq).padStart(8, '0')}`;
}

export function createStepLedgerStore(opts: { storage: StorageAdapter }): StepLedgerStore {
  const { storage } = opts;
  return {
    append: async (executionId, seq, entry) => {
      await storage.set(seqKey(executionId, seq), entry);
    },
    load: async (executionId) => {
      const keys = await storage.list(stepLedgerPrefix(executionId));
      const byPath = new Map<string, StepLedgerEntry>();
      for (const key of keys) {
        const raw = await storage.get(key);
        if (raw === null || raw === undefined) {
          continue;
        }
        const parsed = StepLedgerEntrySchema.safeParse(raw);
        if (!parsed.success) {
          /* A row we cannot read is a step we cannot replay — it simply re-runs.
           * Dropping it is safe; failing the resume over it would not be. */
          console.warn(`StepLedger: discarding unreadable entry "${key}": ${parsed.error.message}`);
          continue;
        }
        byPath.set(parsed.data.path, parsed.data);
      }
      return byPath;
    },
    clear: async (executionId) => {
      const keys = await storage.list(stepLedgerPrefix(executionId));
      for (const key of keys) {
        await storage.delete(key);
      }
    },
  };
}

/**
 * @public
 * The in-memory ledger a single execution carries: entries recovered from a previous
 * run (available for replay) plus the sequence counter for newly recorded ones.
 *
 * Shared by reference across fork/spawn children so one execution has one ledger —
 * path keys are globally unique across the step tree, so a flat map is correct.
 */
export class StepLedger {
  /** Recovered entries, by path. Consumed as replay proceeds. */
  private readonly replayable: Map<string, StepLedgerEntry>;
  private seq: number;
  private readonly store?: StepLedgerStore;
  private readonly executionId: string;

  constructor(opts: {
    executionId: string;
    store?: StepLedgerStore;
    recovered?: Map<string, StepLedgerEntry>;
  }) {
    this.executionId = opts.executionId;
    this.store = opts.store;
    this.replayable = opts.recovered ?? new Map();
    this.seq = this.replayable.size;
  }

  /** True when this execution has nothing recovered to replay (the common, fresh case). */
  get isEmpty(): boolean {
    return this.replayable.size === 0;
  }

  /**
   * The recorded output for `path`, when a previous run completed the same step there.
   * A divergence (different step id or kind at this path) discards the entry and every
   * entry recorded beneath it, then returns undefined so the step runs fresh — the
   * subtree's recorded outputs belong to a branch that no longer exists.
   */
  take(
    path: string,
    step: {
      id: string;
      kind: string;
    },
  ): StepLedgerEntry | undefined {
    const entry = this.replayable.get(path);
    if (!entry) {
      return undefined;
    }
    if (entry.stepId !== step.id || entry.kind !== step.kind) {
      this.discardSubtree(path);
      return undefined;
    }
    return entry;
  }

  /** Drop `path` and everything recorded below it. */
  private discardSubtree(path: string): void {
    for (const key of [
      ...this.replayable.keys(),
    ]) {
      if (key === path || key.startsWith(`${path}/`)) {
        this.replayable.delete(key);
      }
    }
  }

  /** Record a completed step. Best-effort: a failed write costs resumability, not the run. */
  async record(entry: StepLedgerEntry): Promise<void> {
    if (!this.store) {
      return;
    }
    const seq = this.seq;
    this.seq += 1;
    try {
      await this.store.append(this.executionId, seq, entry);
    } catch (error) {
      console.warn(
        `StepLedger: failed to record "${entry.path}":`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
