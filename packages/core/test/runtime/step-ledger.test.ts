// Step-level resume: a restored execution replays the outputs a previous run
// recorded instead of re-running those steps. See specs/23a-step-level-resume.

import { describe, expect, it } from 'bun:test';
import type { Context, ContextMemory } from '@noetic-tools/types';
import { fork } from '../../src/builders/control-flow-builders';
import { loop } from '../../src/builders/loop-builder';
import { step } from '../../src/builders/step-builders';
import { AgentHarness } from '../../src/harness/agent-harness';
import { createCheckpointStore } from '../../src/runtime/durable/checkpoint-store';
import { createStepLedgerStore } from '../../src/runtime/durable/step-ledger';
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
