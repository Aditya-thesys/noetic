// Step-level resume: a restored execution replays the outputs a previous run
// recorded instead of re-running those steps. See specs/23a-step-level-resume.

import { describe, expect, it } from 'bun:test';
import type { StorageAdapter } from '@noetic-tools/memory';
import type { Context, ContextMemory } from '@noetic-tools/types';
import { fork } from '../../src/builders/control-flow-builders';
import { loop } from '../../src/builders/loop-builder';
import { step } from '../../src/builders/step-builders';
import { AgentHarness } from '../../src/harness/agent-harness';
import { createCheckpointStore } from '../../src/runtime/durable/checkpoint-store';
import type { StepLedgerEntry } from '../../src/runtime/durable/step-ledger';
import { createStepLedgerStore, stepLedgerPrefix } from '../../src/runtime/durable/step-ledger';
import { createInMemoryStorage } from '../../src/runtime/in-memory-storage';
import { until } from '../../src/until/predicates';

type Storage = ReturnType<typeof createInMemoryStorage>;
type RunStep = ReturnType<typeof step.run<ContextMemory, string, string>>;

function durableHarness(storage: Storage): AgentHarness {
  return new AgentHarness({
    name: 'ledger-test',
    params: {},
    storage,
    checkpointStore: createCheckpointStore({
      storage,
    }),
  });
}

/** A step that records every dispatch, so a re-run is observable. */
function countingStep(id: string, calls: string[], out: (input: string) => string): RunStep {
  return step.run<ContextMemory, string, string>({
    id,
    execute: async (input: string) => {
      calls.push(id);
      return out(input);
    },
  });
}

/** Compose children the way the workflow hydrator does — a `run` step that dispatches
 *  each child through the harness. There is no standalone `sequence` builder. */
function sequenceOf(harness: AgentHarness, id: string, children: RunStep[]): RunStep {
  return step.run<ContextMemory, string, string>({
    id,
    execute: async (input: string, execCtx) => {
      let current = input;
      for (const child of children) {
        current = String(await harness.run(child, current, execCtx));
      }
      return current;
    },
  });
}

/** Narrow a restore result, failing the test loudly when nothing was recorded. */
function mustRestore(ctx: Context | null): Context {
  if (!ctx) {
    throw new Error('expected a restored context');
  }
  return ctx;
}

async function ledgerPaths(storage: Storage, executionId: string): Promise<string[]> {
  return [
    ...(
      await createStepLedgerStore({
        storage,
      }).load(executionId)
    ).keys(),
  ];
}

describe('step ledger', () => {
  it('records completed steps so a resumed run replays instead of re-running', async () => {
    const storage = createInMemoryStorage();
    const harness = durableHarness(storage);
    const calls: string[] = [];
    const tree = sequenceOf(harness, 'root', [
      countingStep('first', calls, () => 'a'),
      countingStep('second', calls, (i) => `${i}b`),
    ]);

    const ctx = harness.createContext();
    expect(await harness.run(tree, 'go', ctx)).toBe('ab');
    expect(calls).toEqual([
      'first',
      'second',
    ]);

    const resumed = await harness.restore(ctx.id);
    expect(resumed).not.toBeNull();
    calls.length = 0;

    // Same answer, and neither step was dispatched a second time.
    expect(await harness.run(tree, 'go', mustRestore(resumed))).toBe('ab');
    expect(calls).toEqual([]);
  });

  it('replays the RECORDED output, not a fresh one, for a non-deterministic step', async () => {
    // Why resume is memoization rather than skip: a re-run would produce a different
    // value than the rest of the run already observed.
    const storage = createInMemoryStorage();
    const harness = durableHarness(storage);
    let nth = 0;
    const tree = step.run<ContextMemory, string, string>({
      id: 'nondet',
      execute: async () => {
        nth += 1;
        return `run-${nth}`;
      },
    });

    const ctx = harness.createContext();
    expect(await harness.run(tree, 'go', ctx)).toBe('run-1');

    const resumed = await harness.restore(ctx.id);
    expect(await harness.run(tree, 'go', mustRestore(resumed))).toBe('run-1');
    expect(nth).toBe(1);
  });

  it('gives each loop iteration its own key, so one cannot replay into another', async () => {
    const storage = createInMemoryStorage();
    const harness = durableHarness(storage);
    const seen: string[] = [];
    const tree = loop<ContextMemory, string, string>({
      id: 'spin',
      steps: [
        step.run<ContextMemory, string, string>({
          id: 'body',
          execute: async (input: string) => {
            seen.push(input);
            return `${input}.`;
          },
        }),
      ],
      until: until.maxSteps(3),
    });

    const ctx = harness.createContext();
    await harness.run(tree, '', ctx);

    /* Every dispatch of the SAME step id got its own ledger key. If iterations shared
     * one key the count would collapse to 1 and the second iteration would have
     * replayed the first's output instead of seeing its own input. */
    const bodyPaths = (await ledgerPaths(storage, ctx.id)).filter((p) => p.includes('body'));
    expect(seen.length).toBeGreaterThan(0);
    expect(bodyPaths.length).toBe(seen.length);
    expect(new Set(bodyPaths).size).toBe(seen.length);
    // Each input differs, so no iteration replayed a sibling's recorded output.
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('gives sibling fork paths distinct keys', async () => {
    const storage = createInMemoryStorage();
    const harness = durableHarness(storage);
    const tree = fork<ContextMemory, string, string>({
      id: 'fan',
      mode: 'all',
      paths: () => [
        step.run<ContextMemory, string, string>({
          id: 'leg-a',
          execute: async () => 'x',
        }),
        step.run<ContextMemory, string, string>({
          id: 'leg-b',
          execute: async () => 'y',
        }),
      ],
      merge: (results: string[]) => results.join(''),
    });

    const ctx = harness.createContext();
    await harness.run(tree, 'go', ctx);

    const legPaths = (await ledgerPaths(storage, ctx.id)).filter((p) => p.includes('leg-'));
    expect(new Set(legPaths).size).toBe(2);
  });

  it('re-runs a step whose identity changed at that path', async () => {
    const storage = createInMemoryStorage();
    const harness = durableHarness(storage);
    const calls: string[] = [];

    const ctx = harness.createContext();
    await harness.run(
      countingStep('alpha', calls, () => 'a'),
      'go',
      ctx,
    );
    expect(calls).toEqual([
      'alpha',
    ]);

    // A different step now occupies that path, so the recorded output no longer applies.
    const resumed = await harness.restore(ctx.id);
    calls.length = 0;
    const edited = countingStep('beta', calls, () => 'b');
    expect(await harness.run(edited, 'go', mustRestore(resumed))).toBe('b');
    expect(calls).toEqual([
      'beta',
    ]);
  });

  it('replays a completed parent wholesale, without revisiting its children', async () => {
    /* The ledger replays at the coarsest COMPLETED granularity. A composite step is
     * an ordinary `run` step here (that is how the hydrator builds `sequence`), so a
     * parent that finished records the whole subtree's output and a resumed run never
     * descends into it. Efficient for a true resume; it also means editing a child
     * under an unchanged parent has no effect, so a host that changed the workflow
     * must clear the ledger rather than resume onto it. */
    const storage = createInMemoryStorage();
    const harness = durableHarness(storage);
    const calls: string[] = [];

    const ctx = harness.createContext();
    const original = sequenceOf(harness, 'root', [
      countingStep('alpha', calls, () => 'a'),
    ]);
    await harness.run(original, 'go', ctx);

    const resumed = await harness.restore(ctx.id);
    calls.length = 0;
    const editedChild = sequenceOf(harness, 'root', [
      countingStep('beta', calls, () => 'b'),
    ]);

    expect(await harness.run(editedChild, 'go', mustRestore(resumed))).toBe('a');
    expect(calls).toEqual([]);
  });

  it('records nothing when the harness has no checkpoint store', async () => {
    const storage = createInMemoryStorage();
    const harness = new AgentHarness({
      name: 'ephemeral',
      params: {},
      storage,
    });
    const calls: string[] = [];

    const ctx = harness.createContext();
    await harness.run(
      countingStep('only', calls, () => 'a'),
      'go',
      ctx,
    );

    expect(await ledgerPaths(storage, ctx.id)).toEqual([]);
    expect(await harness.restore(ctx.id)).toBeNull();
  });

  it('does not record a failed step, so a resumed run dispatches it again', async () => {
    const storage = createInMemoryStorage();
    const harness = durableHarness(storage);
    let attempts = 0;
    const tree = step.run<ContextMemory, string, string>({
      id: 'flaky',
      execute: async () => {
        attempts += 1;
        throw new Error('boom');
      },
    });

    const ctx = harness.createContext();
    await expect(harness.run(tree, 'go', ctx)).rejects.toThrow();

    expect((await ledgerPaths(storage, ctx.id)).filter((p) => p.includes('flaky'))).toEqual([]);
    expect(attempts).toBe(1);
  });
});

// ── load(): batch read (issue #58) ───────────────────────────────────
//
// `load()` lists the ledger prefix and then reads every key. Reading them one
// await at a time is an N+1 on the recovery path — the moment a D1- or
// network-backed adapter can least afford a burst of round trips. It must go
// through `storageGetMany`, which uses the adapter's batch read when there is
// one and sweeps `get` in parallel when there is not.

interface LedgerStorageSpy {
  storage: StorageAdapter;
  getCalls: string[];
  getManyCalls: string[][];
}

/** Wrap an in-memory adapter, counting reads. `withGetMany: false` hides the
 *  batch read, standing in for an adapter published before it existed. */
function spyOn(inner: Storage, withGetMany: boolean): LedgerStorageSpy {
  const getCalls: string[] = [];
  const getManyCalls: string[][] = [];
  const base: StorageAdapter = {
    get: async <T>(key: string): Promise<T | null> => {
      getCalls.push(key);
      return inner.get<T>(key);
    },
    set: (key, value) => inner.set(key, value),
    delete: (key) => inner.delete(key),
    list: (prefix) => inner.list(prefix),
  };
  if (!withGetMany) {
    return {
      storage: base,
      getCalls,
      getManyCalls,
    };
  }
  return {
    storage: {
      ...base,
      getMany: async <T>(keys: string[]): Promise<Map<string, T>> => {
        getManyCalls.push([
          ...keys,
        ]);
        const found = new Map<string, T>();
        for (const key of keys) {
          const value = await inner.get<T>(key);
          if (value === null) {
            continue;
          }
          found.set(key, value);
        }
        return found;
      },
    },
    getCalls,
    getManyCalls,
  };
}

function entryAt(path: string, stepId: string, output: string): StepLedgerEntry {
  return {
    path,
    stepId,
    kind: 'run',
    output,
    completedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function seedLedger(
  storage: StorageAdapter,
  executionId: string,
  count: number,
): Promise<void> {
  const store = createStepLedgerStore({
    storage,
  });
  for (let seq = 0; seq < count; seq++) {
    await store.append(executionId, seq, entryAt(`/root/${seq}`, `step-${seq}`, `out-${seq}`));
  }
}

describe('step ledger load', () => {
  it('reads the whole ledger in one batch when the adapter supports it', async () => {
    const inner = createInMemoryStorage();
    await seedLedger(inner, 'exec-batch', 5);
    const spy = spyOn(inner, true);

    const loaded = await createStepLedgerStore({
      storage: spy.storage,
    }).load('exec-batch');

    expect(loaded.size).toBe(5);
    expect(spy.getManyCalls.length).toBe(1);
    expect(spy.getManyCalls[0].length).toBe(5);
    expect(spy.getCalls).toEqual([]);
  });

  it('falls back to per-key reads on an adapter with no batch read', async () => {
    const inner = createInMemoryStorage();
    await seedLedger(inner, 'exec-fallback', 3);
    const spy = spyOn(inner, false);

    const loaded = await createStepLedgerStore({
      storage: spy.storage,
    }).load('exec-fallback');

    expect(loaded.size).toBe(3);
    expect(spy.getCalls.length).toBe(3);
    expect(spy.getManyCalls).toEqual([]);
    expect(loaded.get('/root/1')?.output).toBe('out-1');
  });

  it('recovers identical entries through either path', async () => {
    const inner = createInMemoryStorage();
    await seedLedger(inner, 'exec-parity', 4);

    const viaBatch = await createStepLedgerStore({
      storage: spyOn(inner, true).storage,
    }).load('exec-parity');
    const viaFallback = await createStepLedgerStore({
      storage: spyOn(inner, false).storage,
    }).load('exec-parity');

    expect([
      ...viaBatch.keys(),
    ]).toEqual([
      ...viaFallback.keys(),
    ]);
    expect([
      ...viaBatch.values(),
    ]).toEqual([
      ...viaFallback.values(),
    ]);
  });

  it('keeps the last entry recorded at a path, so dispatch order survives batching', async () => {
    const inner = createInMemoryStorage();
    const store = createStepLedgerStore({
      storage: inner,
    });
    // Same path, recorded twice — a loop body re-entering the same slot. The
    // later sequence number must win, which only holds if `load` walks the keys
    // in `list()` order rather than whatever order the batch read returns.
    await store.append('exec-order', 0, entryAt('/root/body', 'body', 'first'));
    await store.append('exec-order', 1, entryAt('/root/body', 'body', 'second'));

    // A batch read returns a map, and nothing in the contract says its iteration
    // order matches the key order asked for — a real backend may return rows in
    // whatever order the query produced. Reverse it here so a `load` that walked
    // the map instead of the keys would recover 'first' and fail.
    const reversing: StorageAdapter = {
      ...inner,
      getMany: async <T>(keys: string[]): Promise<Map<string, T>> => {
        const found = new Map<string, T>();
        for (const key of [
          ...keys,
        ].reverse()) {
          const value = await inner.get<T>(key);
          if (value === null) {
            continue;
          }
          found.set(key, value);
        }
        return found;
      },
    };

    const loaded = await createStepLedgerStore({
      storage: reversing,
    }).load('exec-order');

    expect(loaded.size).toBe(1);
    expect(loaded.get('/root/body')?.output).toBe('second');
  });

  it('still skips a corrupt row that arrives through the batch read', async () => {
    const inner = createInMemoryStorage();
    await seedLedger(inner, 'exec-corrupt', 2);
    await inner.set(`${stepLedgerPrefix('exec-corrupt')}00000009`, {
      path: '',
      nonsense: true,
    });

    const loaded = await createStepLedgerStore({
      storage: spyOn(inner, true).storage,
    }).load('exec-corrupt');

    expect(loaded.size).toBe(2);
    expect(loaded.has('')).toBe(false);
  });
});
