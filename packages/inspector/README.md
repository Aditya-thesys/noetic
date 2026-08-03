# @noetic/inspector

A local web inspector for Noetic agents: edit agent TypeScript in Monaco, chat
with the agent it defines, and watch what the framework does — one tab per
context layer, plus the assembled context window, per-layer token composition,
the plan drawn as a graph, framework events, and traces.

## Run

```bash
OPENROUTER_API_KEY=… bun run inspect   # from the repo root
```

Then open http://localhost:3900. The left pane toggles between **Chat** and
**Code**; the right pane is the inspector.

## How it works

Three processes:

| Process | Port | Role |
|---|---|---|
| Next.js dev server | 3900 | UI only — never imports core |
| Host (`server/host.ts`) | 4700 | agent-file read/save + watch, child lifecycle, reverse proxy |
| Agent child (`server/child.ts`) | 4701 | runs the harness, serves chat + inspector HTTP/SSE |

The editor edits `.data/agent.ts` (seeded from `agent/default-agent.ts`).
Saving triggers the host to restart the agent child — a **fresh Bun process
per code revision**, because Bun's module cache means an in-process re-import
would never re-execute the edited file. The conversation survives the restart:
after every turn the child rewrites `.data/sessions/<threadId>/items.jsonl`
from the harness's full item log, and the next child seeds its session from
that file (`seedFromItems`). Durable context-layer state lives under
`.data/storage/` via `createFileStorage`.

## The Workflow tab

Draws whatever the plan layer is holding — the reviewed plan tree, and each
named workflow the tree points at through a `subflow` ref. Clicking a `subflow`
node opens the workflow it names, which is why the tree is meant to stay small:
the detail is one click away rather than crowded into the picture the user
reviews.

What is drawn is **control flow**, not the JSON tree, and it is drawn to match
what the interpreter actually does:

| Node | Drawn as |
|---|---|
| `sequence` | a chain; the sequence itself is not drawn |
| `fork` | a split, rejoining at a join node carrying the merge strategy — or, for `mode: 'race'`, a "first wins" node, since a race aborts the losers and never merges |
| `branch` | a gate with **numbered** routes, because the runtime takes the first match and later routes may be unreachable |
| `loop` | body first, then the gate — it is a do-while, so the body always runs at least once. The return edge is animated and labelled `repeat`; the `until` predicate and the iteration cap are chips on the gate |
| `every` | a timer with **no exit**, because `executeEvery` only returns by throwing. Steps after it are drawn unconnected, which is how you spot that they are unreachable |
| `spawn` / `provide` | a gate the flow passes through, with a dashed edge marking the context change |
| `subflow` | a `ref` stays a leaf you can click to open; an **inline** document is drawn in full, since there is no named workflow to switch to |

Layout is [dagre](https://github.com/dagrejs/dagre)'s layered ranking, with the
loop back-edges held out of the ranking pass so a cycle cannot reorder the
graph. `↓` / `→` in the toolbar switches direction.

The projection (`lib/workflow-graph.ts`) and the placement
(`lib/workflow-layout.ts`) are pure functions, tested in `test/`. They render
nothing; the placement imports React Flow only for its `Position` and
`MarkerType` constants.

A document that reaches the viewer from durable storage was validated when it
was written, not when it was read, so the projection is defensive: a node
missing its children is drawn as `malformed` rather than thrown over, and a
document that defeats it entirely is reported in the tab instead of unmounting
the inspector.

The agent file's contract:

```ts
export function createAgent(deps: {
  storage: StorageAdapter;
  traceExporter: TraceExporter;
}): { harness: AgentHarness };
```

Pass `deps.storage` and `deps.traceExporter` to the harness — they are what
make layer persistence and the Trace tab work.

## Tests

```bash
cd packages/inspector
bun test test/       # unit + a stub-model end-to-end (no network, no API key)
bun run typecheck    # Next app + server configs
```
