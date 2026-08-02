## @noetic-tools/context-v2.0.0 (2026-07-26)

* feat(core): batch read on StorageAdapter, so ledger restore is not an N+1 ([6bb7b87](https://github.com/mattapperson/noetic/commit/6bb7b87)), closes [#58](https://github.com/mattapperson/noetic/issues/58)

### BREAKING CHANGE

* `ScopedStorage` gains a required `getMany` method. Code
that implements the interface directly — in practice only test doubles, as
the framework constructs the real one via `createScopedStorage` — must add
it. `StorageAdapter.getMany` is optional and breaks nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bp3JE94xvmxr4WWZ2bYjJJ

## @noetic-tools/context-v1.1.0 (2026-07-24)

* feat(memory): give durable-task-state a write API and a fan-out-safe merge ([f09d5b0](https://github.com/mattapperson/noetic/commit/f09d5b0))

## @noetic-tools/context-v1.0.3 (2026-07-20)

* fix(memory): accept plan/setPlanTree tree as object or JSON string ([25a4a72](https://github.com/mattapperson/noetic/commit/25a4a72))

## @noetic-tools/context-v1.0.2 (2026-07-20)

* fix(memory): wrap plan/setPlanTree input in an object ([8f6f0ba](https://github.com/mattapperson/noetic/commit/8f6f0ba))

## @noetic-tools/context-v1.0.1 (2026-06-10)

* fix: skip uninitialized layers, strip bun exports ([3c83c57](https://github.com/mattapperson/noetic/commit/3c83c57))

## @noetic-tools/context-v1.0.0 (2026-06-10)

* feat(memory)!: harden layers, budget, lifecycle ([39cc778](https://github.com/mattapperson/noetic/commit/39cc778))
* build: resolve workspace deps to src via bun export condition ([b774d38](https://github.com/mattapperson/noetic/commit/b774d38))

### BREAKING CHANGE

* durableTaskState() no longer accepts a config
object; DurableTaskStateConfig and DurableTaskStateSerializer
are removed.

## @noetic-tools/context-v0.2.0 (2026-06-08)

* fix(core): address adversarial review findings in context layers ([bac97a0](https://github.com/mattapperson/noetic/commit/bac97a0))
* fix(core): durable-task-state persistence + steering guidance/casing/retries ([17a8ae8](https://github.com/mattapperson/noetic/commit/17a8ae8))
* fix(core): lifecycle consistency + fail-loud init for context layers ([6b0bd01](https://github.com/mattapperson/noetic/commit/6b0bd01))
* fix(core): per-layer memory bugs (budget, dedup, merge, capture, recovery) ([1092992](https://github.com/mattapperson/noetic/commit/1092992))
* fix(core): repair plan context layer state machine and recall ([55e961f](https://github.com/mattapperson/noetic/commit/55e961f))
* feat(core): wire budget allocation, recall modes, assembleView cap, and re-render ([32e9f99](https://github.com/mattapperson/noetic/commit/32e9f99))
* refactor(core): extract context layer system into @noetic-tools/context + @noetic-tools/types (#39) ([4a4adc5](https://github.com/mattapperson/noetic/commit/4a4adc5)), closes [#39](https://github.com/mattapperson/noetic/issues/39) [#36](https://github.com/mattapperson/noetic/issues/36)
