import type {
  AgentHarnessContract,
  Channel,
  ChannelStore,
  Context,
  ContextMemory,
  CwdState,
  EventBroadcaster,
  FrontierFrame,
  FsAdapter,
  Item,
  ItemLog,
  ItemSchemaRegistry,
  LastLayerUsage,
  MemoryLayer,
  Span,
  StepMeta,
  TokenUsage,
  Tool,
} from './context-deps';
import { buildContextMemory, defaultItemSchemaRegistry } from './context-deps';
import type { StepLedger } from './durable/step-ledger';
import { ItemLogImpl } from './item-log-impl';

const EMPTY_MEMORY: ContextMemory = Object.freeze({});

class NoopSpan implements Span {
  readonly traceId = crypto.randomUUID();
  readonly spanId = crypto.randomUUID();
  readonly parentSpanId = null;
  setAttribute(_key: string, _value: string | number | boolean): void {}
  addEvent(_name: string, _attributes?: Record<string, string | number | boolean>): void {}
  end(): void {}
}

export class ContextImpl implements Context<ContextMemory> {
  readonly id: string;
  stepCount = 0;
  tokens: TokenUsage = {
    input: 0,
    output: 0,
    total: 0,
  };
  cost = 0;
  state: unknown;
  readonly parent: Context<ContextMemory> | null;
  readonly depth: number;
  readonly span: Span;
  readonly threadId: string;
  readonly resourceId?: string;
  readonly itemLog: ItemLog;
  lastStepMeta: StepMeta | null = null;
  lastLayerUsage: LastLayerUsage | undefined = undefined;
  readonly harness: AgentHarnessContract;
  readonly layers?: MemoryLayer[];
  unifiedTools?: ReadonlyArray<Tool>;
  readonly itemSchemas?: ItemSchemaRegistry;
  readonly cwdState: CwdState;

  /** @internal Event broadcaster for streaming — not part of public Context interface. */
  readonly _broadcaster?: EventBroadcaster;

  private readonly _createdAt: number;
  /**
   * Shared channel store for cross-context communication. Inherited by
   * `fork` / `spawn` children so channels published by a sibling are visible
   * to peers — see `executeFork` and `executeSpawn` in `interpreter/execute-action.ts`
   * and `interpreter/execute-control.ts`.
   * @internal
   */
  readonly channelStore?: ChannelStore;
  private _checkpointFn?: (ctx: Context) => Promise<void>;
  private _completionValue?: unknown;
  private _completed = false;
  private _aborted = false;
  private _abortReason?: string;
  /**
   * Per-context abort fan-out. `abort()` fires it so operations blocked on
   * this context (channel `recv` waiters, parked back-pressure senders)
   * reject promptly with `{ kind: 'cancelled' }` instead of hanging until
   * their timeout (spec 09, Cancellation item 2). Each fork/spawn child
   * constructs its own ContextImpl and therefore its own controller —
   * aborting a child never rejects the parent's waiters.
   */
  private readonly _abortController = new AbortController();
  private _memory?: ContextMemory;
  /**
   * Stack of steps currently in flight on this context, most-recent last.
   * Pushed by `enterStep` at the top of `execute()` and popped by
   * `leaveStep` when the step resolves (success or failure). The harness'
   * checkpoint writer serialises this stack as the execution frontier so
   * a restart can identify which step the context was paused inside.
   * @internal
   */
  private readonly _frontier: FrontierFrame[] = [];

  /**
   * Path segment for each in-flight frame, parallel to `_frontier`. Kept separate so
   * `serialiseFrontier()` keeps emitting the published `FrontierFrame` shape.
   * @internal
   */
  private readonly _segments: string[] = [];

  /**
   * Path this context's steps hang under. Empty on a root context; a fork/spawn child
   * inherits its parent's current path plus a discriminator, so a path key stays unique
   * across the whole step tree rather than restarting per child context.
   * @internal
   */
  private readonly _pathPrefix: string;

  /**
   * Dispatch counts per `<parent path>/<step id>`, so a loop body re-entered on each
   * iteration gets `#0`, `#1`, … instead of colliding on one key.
   * @internal
   */
  private readonly _occurrences = new Map<string, number>();

  /**
   * Completion ledger for the execution this context belongs to. Shared by reference
   * with fork/spawn children — one execution, one ledger.
   * @internal
   */
  readonly ledger?: StepLedger;

  constructor(opts: {
    harness: AgentHarnessContract;
    parent?: Context;
    items?: Item[];
    state?: unknown;
    threadId?: string;
    resourceId?: string;
    span?: Span;
    channelStore?: ChannelStore;
    checkpointFn?: (ctx: Context) => Promise<void>;
    /** Path this context's steps hang under (fork/spawn children inherit one). */
    pathPrefix?: string;
    /** The execution's completion ledger, shared with children by reference. */
    ledger?: StepLedger;
    layers?: MemoryLayer[];
    unifiedTools?: ReadonlyArray<Tool>;
    itemSchemas?: ItemSchemaRegistry;
    cwdState?: CwdState;
    _broadcaster?: EventBroadcaster;
    /**
     * Pre-chosen context id. When set, the ContextImpl adopts this id instead
     * of generating a fresh UUID. Used by `executeSpawn` so the child's
     * `ctx.id` matches the `executionId` keyed into the layer-state store —
     * otherwise writes via `ctx.memory[layerId].state` land on one id while
     * spawn's `onReturn` reads from another, silently losing the update.
     */
    id?: string;
  }) {
    this.id = opts.id ?? crypto.randomUUID();
    this._createdAt = Date.now();
    this.harness = opts.harness;
    this.state = opts.state ?? {};
    this.parent = opts.parent ?? null;
    this.depth = this.parent ? this.parent.depth + 1 : 0;
    this.span = opts.span ?? new NoopSpan();
    this.threadId = opts.threadId ?? crypto.randomUUID();
    this.resourceId = opts.resourceId;
    this.channelStore = opts.channelStore;
    this._checkpointFn = opts.checkpointFn;
    this._pathPrefix = opts.pathPrefix ?? '';
    this.ledger = opts.ledger;
    this.layers = opts.layers;
    this.unifiedTools = opts.unifiedTools;
    this.itemSchemas = opts.itemSchemas ?? defaultItemSchemaRegistry;
    this.cwdState = opts.cwdState ?? {
      cwd: process.cwd(),
    };
    this._broadcaster = opts._broadcaster;

    const log = new ItemLogImpl(this.itemSchemas);
    if (opts.items) {
      for (const item of opts.items) {
        log.append(item);
      }
    }
    this.itemLog = log;
  }

  get elapsed(): number {
    return Date.now() - this._createdAt;
  }

  get aborted(): boolean {
    return this._aborted;
  }

  get fs(): FsAdapter {
    return this.harness.fs;
  }

  get shell(): AgentHarnessContract['shell'] {
    return this.harness.shell;
  }

  get subprocess(): AgentHarnessContract['subprocess'] {
    return this.harness.subprocess;
  }

  get memory(): ContextMemory {
    if (!this._memory) {
      this._memory = this.layers ? buildContextMemory(this.layers, this) : EMPTY_MEMORY;
    }
    return this._memory;
  }

  recv<T>(
    ch: Channel<T>,
    opts?: {
      timeout?: number;
    },
  ): Promise<T> {
    if (!this.channelStore) {
      return Promise.reject(new Error('No channel store configured'));
    }
    return this.channelStore.recv(ch, opts?.timeout, this._abortController.signal);
  }

  send<T>(ch: Channel<T>, value: T): Promise<void> {
    if (!this.channelStore) {
      return Promise.reject(new Error('No channel store configured'));
    }
    // Internal sender: back-pressured on full queue channels (default 30s →
    // channel_timeout); aborting this context rejects a parked send with
    // 'cancelled' via the shared abort signal.
    return this.channelStore.send(ch, value, {
      signal: this._abortController.signal,
    });
  }

  tryRecv<T>(ch: Channel<T>): T | null {
    if (!this.channelStore) {
      throw new Error('No channel store configured');
    }
    return this.channelStore.tryRecv(ch);
  }

  async checkpoint(): Promise<void> {
    if (this._checkpointFn) {
      await this._checkpointFn(this);
    }
  }

  complete<T>(value: T): void {
    this._completed = true;
    this._completionValue = value;
  }

  get completed(): boolean {
    return this._completed;
  }

  get completionValue(): unknown {
    return this._completionValue;
  }

  get abortReason(): string | undefined {
    return this._abortReason;
  }

  abort(reason?: string): void {
    this._aborted = true;
    this._abortReason = reason;
    // Reject everything blocked on this context (channel recv waiters,
    // parked back-pressure senders) with { kind: 'cancelled' }. Idempotent —
    // a second abort() leaves the already-aborted signal untouched.
    this._abortController.abort(reason ?? 'context aborted');
  }

  /**
   * @internal
   * Abort signal scoped to this context. Channel operations register on it
   * so `abort()` rejects them promptly. Not part of the public Context
   * interface.
   */
  get abortSignal(): AbortSignal {
    return this._abortController.signal;
  }

  /**
   * @internal
   * Push a frame onto the execution frontier. Called by `execute()` at the
   * top of every step dispatch so that the frontier reflects exactly the
   * stack of steps currently in-flight on this context.
   */
  enterStep(frame: FrontierFrame): void {
    const parent = this.currentPath();
    const key = `${parent}/${frame.stepId}`;
    const occurrence = this._occurrences.get(key) ?? 0;
    this._occurrences.set(key, occurrence + 1);
    this._segments.push(`/${frame.stepId}#${occurrence}`);
    this._frontier.push(frame);
  }

  /**
   * @internal
   * The execution path of the step currently on top of the frontier — the ledger key
   * identifying this exact dispatch. Stable across a replay given the same control
   * flow, which is what lets a resumed run line recorded outputs up with the steps
   * that produced them.
   */
  currentPath(): string {
    return this._pathPrefix + this._segments.join('');
  }

  /**
   * @internal
   * Pop the top frame. Called when a step resolves (success or failure)
   * so that the frontier unwinds cleanly. The value of `expectedStepId`
   * is used as a consistency check — if it does not match the top frame
   * the pop is still performed, but a best-effort warning is surfaced to
   * stderr rather than swallowed silently.
   */
  leaveStep(expectedStepId: string): void {
    const top = this._frontier[this._frontier.length - 1];
    if (top && top.stepId !== expectedStepId) {
      // A mismatch indicates bookkeeping drift. We unwind best-effort and
      // let the caller observe via `serialiseFrontier()` if needed.
      console.warn(
        `ContextImpl.leaveStep: expected "${expectedStepId}" on top of frontier but saw "${top.stepId}".`,
      );
    }
    this._frontier.pop();
    this._segments.pop();
  }

  /**
   * @internal
   * Return a defensive copy of the current frontier. Consumed by the
   * checkpoint writer — see `AgentHarness.checkpoint`.
   */
  serialiseFrontier(): FrontierFrame[] {
    return this._frontier.map((frame) => ({
      stepId: frame.stepId,
      input: frame.input,
      state: frame.state,
    }));
  }
}
