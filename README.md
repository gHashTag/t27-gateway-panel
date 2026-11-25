# @local/t27-gateway — observation-only audit panel (DSH web plugin)

A DSH web plugin that shows the t27 MCP gateway audit log (`gateway-audit.log`,
law-encoded TAB-separated records, 7 fields per
`mcp/gateway/schema.md`) as a dock panel under the chat composer.

All panel decisions — parsing, filtering, states, row cap, narrow-width layout,
badge tokens, labels — live in `.t27` specs under `spec/` and ship as generated
ES modules under `generated/`. JavaScript is thin plumbing only: an HTTP host
half (`index.js`) and a React adapter (`client.js`). The old hand-written UI is
kept under `legacy/` for reference and must never ship.

## Routes (host half, GET only, auth-fenced)

- `/api/t27-gateway/audit` → `{ contractVersion, source:{path,present,reason},
  events:[{ts,actor,tool,scope,decision,reason,requestHash}], total, dropped }`
- `/api/t27-gateway/health` → `{ host:'local', idempotent:true, mutating:false,
  contractVersion, checks:[…], anomalies:[…] }`

The audit log path resolves from `T27_GATEWAY_AUDIT_PATH` if set, else walks up
from the package dir for `.trinity/gateway-audit.log` (≤ 8 levels).

## Panel states (spec-owned, fail-closed)

| state          | meaning                                                        |
|----------------|----------------------------------------------------------------|
| `loading`      | first fetch in flight                                           |
| `ready`        | events rendered, capped to the tail bound                       |
| `empty`        | log present, zero events                                        |
| `source-absent`| log file absent — the panel names the missing path, never fakes |
| `error`        | fetch failed (e.g. HTTP 404/401) — retry button offered         |

## Producer status (measured 2026-11-25)

Nothing in `/Users/playra/t27` currently writes `gateway-audit.log`: the M0
gateway binary (`tri-mcp`) is not built anywhere on this machine and the
`mcp-m0` worktree it lived in is gone. Until that binary is rebuilt, the panel
truthfully renders the `source-absent` state with the expected path. Do not
seed the log by hand — a fabricated audit trail is a lie.

## Build and test

```
sh scripts/build.sh        # t27c check/test + gen-js into generated/, then node --test test/
node --test test/          # tests alone (imports the generated modules)
```

`generated/` is a build artifact, gitignored, never hand-written or hand-copied.

## Install (DSH)

`plugin_manager` → `install_bundle` with this absolute directory. Rollback:
`remove_bundle @local/t27-gateway`. The patch inserts client id
`t27-gateway-ui` → `@local/t27-gateway`; the panel mounts into the
`conversation.composer.dock` slot (id `t27-gateway-dashboard`, order 6).
