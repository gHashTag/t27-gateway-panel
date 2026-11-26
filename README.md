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
  events:[{ts,actor,tool,scope,decision,reason,requestHash}], total, dropped,
  counters:{allow,deny,denyRate,total} }`
  - Query filters (all optional): `tool=<exact tool name>`, `decision=<label
    from DECISION_OPTIONS[1..]>`, `text=<case-insensitive substring over actor
    or tool>`. Unknown `decision` label → 400 with the expected list. The host
    applies the generated `filterEvents` — the client owns no filtering rule.
  - `counters` is counted over the SAME filtered event set the panel renders.
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

## Generated surface and platform bridges

The gen-js backend lowers scalar parameters and scalar returns only. Every
rule — thresholds, labels, option lists, tokens, state resolution, filtering —
compiles out of the specs. Two mechanical composition layers exist around that
boundary, and they are the only places JS holds logic-shaped code:

1. `bridge/gateway_logic_bridge.mjs` — appended to the fresh `t27c gen-js`
   output by `scripts/build.sh` (byte-identical assembly, verified by `cmp`).
   It composes the runtime API (`parseAuditLine`, `filterEvents`,
   `countByDecision`, `applyTail`) out of generated consts; every threshold,
   table and reason string in it is an emitted const from
   `spec/gateway_logic.t27` (13/13 tests, 0 vacuous).
2. `scripts/emit_client_gateway_ui.mjs` — turns `generated/gateway_ui.mjs`
   into the loadable classic-script chunk `client.gateway_ui.js`
   (`__ModuleLoader__.load`, chunk id
   `@local/t27-gateway/client.gateway_ui.js`). It refuses to emit when the
   generator's `__NOT_EMITTED__` list is non-empty or a `__DECL_ORDER__` name
   is missing from the body. `client.js` then renders only from that chunk's
   generated scalars — the object assembly (`buildViewModel` equivalent) is
   this documented bridge exception; nothing in the client may decide a
   threshold, a label or a token.

A refit procedure: fix the spec, run `sh scripts/build.sh`; the build
regenerates both artifacts and re-assembles both bridges.

## Install (DSH)

`plugin_manager` → `install_bundle` with this absolute directory. Rollback:
`remove_bundle @local/t27-gateway`. The patch inserts client id
`t27-gateway-ui` → `@local/t27-gateway`; the panel mounts into the
`conversation.composer.dock` slot (id `t27-gateway-dashboard`, order 6).
