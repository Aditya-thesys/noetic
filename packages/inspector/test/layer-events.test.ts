import { describe, expect, it } from 'bun:test';
import type { LayerStateEvent, SettableStateStore } from '../server/layer-events';
import { decorateLayerStateStore } from '../server/layer-events';

interface Recorded {
  executionId: string;
  layerId: string;
  state: unknown;
}

function stubStore(): SettableStateStore & {
  writes: Recorded[];
} {
  const writes: Recorded[] = [];
  return {
    writes,
    set<T>(executionId: string, layerId: string, state: T): void {
      writes.push({
        executionId,
        layerId,
        state,
      });
    },
  };
}

describe('decorateLayerStateStore', () => {
  it('still writes through to the original set', () => {
    const store = stubStore();
    decorateLayerStateStore(store, {
      onChange: () => undefined,
      isSuppressed: () => false,
    });
    store.set('exec-1', 'working-memory', {
      note: 'x',
    });
    expect(store.writes).toEqual([
      {
        executionId: 'exec-1',
        layerId: 'working-memory',
        state: {
          note: 'x',
        },
      },
    ]);
  });

  it('emits a change event per write and tracks the latest executionId', () => {
    const store = stubStore();
    const events: LayerStateEvent[] = [];
    const tracker = decorateLayerStateStore(store, {
      onChange: (event) => events.push(event),
      isSuppressed: () => false,
    });
    store.set('exec-1', 'plan', 1);
    store.set('exec-2', 'plan', 2);
    expect(events.map((event) => event.executionId)).toEqual([
      'exec-1',
      'exec-2',
    ]);
    expect(tracker.currentExecutionId('plan')).toBe('exec-2');
    expect(tracker.currentExecutionId('unknown')).toBeUndefined();
  });

  it('rewriting an identical value emits no event but still tracks the executionId', () => {
    const store = stubStore();
    const events: LayerStateEvent[] = [];
    const tracker = decorateLayerStateStore(store, {
      onChange: (event) => events.push(event),
      isSuppressed: () => false,
    });
    store.set('exec-1', 'working-memory', {
      note: 'same',
    });
    // A new turn re-hydrates to the same content — a re-render, not a change.
    store.set('exec-2', 'working-memory', {
      note: 'same',
    });
    expect(events.length).toBe(1);
    expect(tracker.currentExecutionId('working-memory')).toBe('exec-2');
  });

  it('a genuine value change after a no-op rewrite emits again', () => {
    const store = stubStore();
    const events: LayerStateEvent[] = [];
    decorateLayerStateStore(store, {
      onChange: (event) => events.push(event),
      isSuppressed: () => false,
    });
    store.set('exec-1', 'plan', {
      phase: 'idle',
    });
    store.set('exec-2', 'plan', {
      phase: 'idle',
    });
    store.set('exec-2', 'plan', {
      phase: 'planning',
    });
    expect(events.length).toBe(2);
  });

  it('clearing state to undefined counts as a change once', () => {
    const store = stubStore();
    const events: LayerStateEvent[] = [];
    decorateLayerStateStore(store, {
      onChange: (event) => events.push(event),
      isSuppressed: () => false,
    });
    store.set('exec-1', 'plan', {
      phase: 'idle',
    });
    store.set('exec-1', 'plan', undefined);
    store.set('exec-1', 'plan', undefined);
    expect(events.length).toBe(2);
  });

  it('suppressed writes reach the store but emit nothing and track nothing', () => {
    const store = stubStore();
    const events: LayerStateEvent[] = [];
    let suppressed = false;
    const tracker = decorateLayerStateStore(store, {
      onChange: (event) => events.push(event),
      isSuppressed: () => suppressed,
    });

    store.set('exec-1', 'plan', 1);
    suppressed = true;
    store.set('preview-exec', 'plan', 2);
    suppressed = false;

    expect(store.writes.length).toBe(2);
    expect(events.length).toBe(1);
    // The preview's throwaway executionId must not become "current".
    expect(tracker.currentExecutionId('plan')).toBe('exec-1');
  });
});
