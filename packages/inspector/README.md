# @noetic/inspector

A local web inspector for Noetic agents: edit agent TypeScript in Monaco, chat
with the agent it defines, and watch what the framework does — one tab per
context layer, plus the assembled context window, per-layer token composition,
framework events, and traces.

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
