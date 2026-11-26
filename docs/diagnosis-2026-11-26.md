# Gateway audit panel: broken layout + empty audit counters - diagnosis

Date: 2026-11-26
Machine: ~ (macOS), DSH web live on 127.0.0.1:3081 (pid 88005, cwd ~/deepseek-harness)
Panel package: <repo> (git, local-only, no remote; HEAD f1de7fb "spec-first migration")
Live install: ~/.dsh/profiles/web/node_modules/@local/t27-gateway -> symlink to <repo>
Browser evidence: BrowserOS neo, page 52, http://127.0.0.1:3081, viewport 450x799

## PART 1 - the broken layout (measured, not inferred)

The panel is mounted into the host slot `conversation.composer.dock`
(client.js: `ctx.slots.register({ name: 'conversation.composer.dock', id: 't27-gateway-dashboard', order: 6 }, GatewayPanel)`).

Measured DOM geometry on the live page (BrowserOS neo evaluateInPage):

| node                              | width | scrollWidth | note                                   |
|-----------------------------------|-------|-------------|----------------------------------------|
| host dock `.efWx4G_dock`          | 411   | 538         | display:flex, row, nowrap, justify:center |
| host chip "148 turns 3073 steps"  | 58    | -           | flex 0 1 auto, minWidth 0              |
| host chip "524M tok / Cache hit"   | 48    | -           | flex 0 1 auto, minWidth 0              |
| PANEL ROOT                        | 205   | 407         | overflow-x: visible, minWidth: 0       |
| host chip "54%"                   | 64    | -           | flex 0 0 auto                          |
| panel toolbar row (4 children)    | 179   | 395         | display:flex, flex-wrap: nowrap       |
| toolbar select #1                 | 144   | 142         | maxWidth 160 (style), option text wide |
| toolbar select #2                 | 91    | 89          | maxWidth 160 (style)                   |
| toolbar input                     | 88    | 84          | style flex '1 1 120px', minWidth 80    |
| toolbar button "Retry"            | 49    | 45          |                                           |
| detail line (source path)         | 179   | 214         | white-space normal, overflow-wrap normal |
| counters line                     | 179   | 179         | fits                                    |
| state line                        | 179   | 214         | carries the same long path             |

Horizontal spill: the toolbar children end at viewport x=554 while the panel root
ends at x=351 -> 203 px of the panel's content is painted OUTSIDE the panel box,
over the neighbouring host widget (the "54%" chip). The panel root's own
overflow is 407-203 = 204 px. The screenshot shows exactly this: the two select
boxes are cut off and the "Retry" button is drawn over the host chip.

Why the content does not fit - three independent causes, all in the hand-written
client (client.js), none of them in the .t27 law:

1. TOOLBAR DOES NOT WRAP. client.js:229-253 builds the filter row with
   `{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }` and no
   `flexWrap`. The legacy hand-written UI had `flexWrap: 'wrap'` on the same row
   (legacy/client.js:52). The spec-first migration (f1de7fb) dropped it. The
   minimum intrinsic width of that row is 144+91+88+49 + 3*8 gap = 396 px, and
   the available width inside the panel is 179 px -> 216 px overflow, always.
   The spec owns a narrow law (NARROW_MAX_WIDTH_PX = 480, is_narrow) but the
   client uses it ONLY to hide two table columns in a row; it is never applied
   to the toolbar. The narrow law is therefore half-implemented.
2. THE SELECTS CARRY A HARD-CODED MAX WIDTH. client.js:186
   `const selectStyle = { ...ellipsisStyle, maxWidth: 160 };` - 160 px is a
   layout threshold written in JavaScript, which the repo's own README forbids
   ("nothing in the client may decide a threshold, a label or a token"). The
   first select is 144 px wide purely because of that literal; the longest
   option is "gateway.policy.audit".
3. THE LONG PATH DOES NOT BREAK. The source path
   `<repo>/.trinity/gateway-audit.log` is one
   unbreakable token in a 179 px box with the default `overflow-wrap: normal`,
   so the detail line and the state line each overflow by 35 px
   (214 - 179). The spec's state_detail() deliberately passes the path through
   unchanged, so the break policy has to live in the layout, not in the text.

What is NOT the cause: the panel is not being rendered by a stale bundle. The
installed bundle is a symlink to the same directory, client.js is byte-identical
(`cmp` -> SAME_CLIENT), and the generated law artifact in the browser is the
current one (its `__DECL_ORDER__` lists exactly the 22 names the current spec
declares). The layout bug is in the source, not in a stale deploy.

Reproduction is width-independent in practice: the toolbar's intrinsic
minimum (396 px) exceeds the panel's content box at every dock width below
~420 px, and the dock itself is a nowrap flex row, so the panel never gets
wider than the host chips leave it.

## PART 2 - why the audit counters are all zero

The zeros are not a counting bug. They are the honest consequence of the audit
source not existing.

Chain of facts:

1. The panel host half (index.js:38-50, findAuditLog) locates the log by
   walking UP from the package directory (max 8 levels) looking for
   `.trinity/gateway-audit.log`, else it returns the package-local path
   `<pkg>/.trinity/gateway-audit.log`. The live bundle is a symlink to
   <repo>, so the reported path is
   `<repo>/.trinity/gateway-audit.log`.
2. That file does not exist. `ls -la <repo>/.trinity`
   -> "No such file or directory"; a bounded `find` over <t27-checkout>,
   ~/workspace and ~/.dsh for `gateway-audit.log`
   returns nothing. There is no `.trinity` directory anywhere near the plugin.
3. Therefore readAuditTail() takes its catch branch and returns
   `{ source: { present: false, reason: 'absent' }, events: [], total: 0, dropped: 0 }`.
   countByDecision([]) returns all-zero counters, so "allow 0 - deny 0 -
   deny rate 0 - total 0" and "0 malformed lines dropped" are ARITHMETICALLY
   CORRECT for an absent file. The state line "Audit source not present -- <path>"
   is the fail-closed state the spec defines (resolve_state_kind: absent source
   is checked before the empty check) and it is rendering as designed.
4. The producer does not exist on this machine. The writer is
   `cli/tri-mcp/src/main.rs` in the t27 repo: `root.join(".trinity/gateway-audit.log")`
   where root = find_repo_root() (the dir holding `.trinity`, or `specs/` + `.git`).
   That code IS on t27 master (commit d04074a72 "feat(mcp): V12 introspection
   tools + audit sink", ancestor of master, confirmed with
   `git merge-base --is-ancestor`), and it is present in the working tree of
   <t27-checkout>/.agents/worktrees/dsh-5540edfe-fe8f. But:
   - the `tri-mcp` BINARY is not built anywhere: no `target/release/tri-mcp`,
     no `target/debug/tri-mcp`, `which tri-mcp` -> not found, a bounded find
     over ~ returns no file named tri-mcp;
   - the live DSH profile does not even start tri-mcp: the only t27 MCP row in
     ~/.dsh/profiles/web/cordis.patch.yml is `@local/t27-mcp`, whose patch runs
     `node <t27-checkout>-mcp/server.mjs` - a DIFFERENT, 23-tool, read-only
     t27 catalogue server (t27_status, t27_formats, t27_specs, ...) with no
     gateway.* tools, no cdp.observe, and no audit sink at all;
   - so nothing can ever call the four audit-producing tools
     (cdp.observe, dsh.status, gateway.status, gateway.policy.audit) that the
     panel's filter list offers.
5. The panel's own README already states this: "Producer status (measured
   2026-11-25): Nothing in <t27-checkout> currently writes gateway-audit.log:
   the M0 gateway binary (tri-mcp) is not built anywhere on this machine and
   the mcp-m0 worktree it lived in is gone." The panel is telling the truth.

So the panel is honest about the missing source; the ZEROS are a symptom of a
missing producer, and the "broken layout" is a separate, real bug in the
hand-written client half.

### The audit-source path would also be wrong even after the producer is built

find_repo_root() in tri-mcp resolves the repo root from the PROCESS CWD (a dir
containing `.trinity`, else `specs/` + `.git`). The plugin's findAuditLog()
resolves from the PACKAGE DIRECTORY. Those are two different anchors. The
plugin lives at <repo>, which is not inside
the t27 checkout, so even a working tri-mcp started in <t27-checkout> would
write <t27-checkout>/.trinity/gateway-audit.log while the panel would look
at <repo>/.trinity/gateway-audit.log - a
path that will never exist. The only bridge today is the
`T27_GATEWAY_AUDIT_PATH` env override (index.js:39), and the live DSH process
(pid 88005) does not have it set. Without that override or a shared anchor,
building tri-mcp alone would NOT make the counters move.

## PART 3 - the fix that was commissioned

Lane: <repo>/.lane/narrow-layout
(branch lane/narrow-layout, from master f1de7fb), brief in .lane-brief.md.

Scope: the LAYOUT only. The audit producer is a separate track (build tri-mcp,
start it under DSH, and fix the two-anchor path mismatch - the plugin's
findAuditLog vs tri-mcp's find_repo_root). No JS threshold may be invented:
the toolbar max width and the input min width move into spec/gateway_ui.t27,
client.js only reads the generated values, and the toolbar wraps when the
generated is_narrow(width) is true.

Acceptance: `sh scripts/build.sh` exits 0 (t27c check + test-report + gen-js +
emitter + node --test), the spec test blocks cover the new law, the generated
artifacts are rebuilt and never hand-edited, and the live DOM shows the panel
root scrollWidth == clientWidth with the toolbar wrapped.

## Evidence commands (re-runnable)

    # layout, live page
    #   BrowserOS neo -> page 52 -> evaluateInPage:
    #     panel = [...document.querySelectorAll('div')]
    #       .find(n => n.textContent.trim().startsWith('Gateway audit'));
    #     panel.scrollWidth - panel.clientWidth   -> 204
    #     toolbar row scrollWidth - clientWidth    -> 216
    curl -s http://127.0.0.1:3081/api/t27-gateway/audit   # (needs the DSH auth fence)

    # audit source
    ls -la <repo>/.trinity          # No such file
    find <t27-checkout> ~/workspace ~/.dsh \
         -maxdepth 6 -name gateway-audit.log                           # nothing
    find ~ -maxdepth 6 -type f -name tri-mcp                # nothing (not built)
    grep -n 'gateway-audit' <t27-checkout>/cli/tri-mcp/src/main.rs   # 0 hits on HEAD
    git -C <t27-checkout> show master:cli/tri-mcp/src/main.rs | grep -c gateway-audit  # 2
    grep -n 'serverName\|args:' ~/.dsh/profiles/web/cordis.patch.yml | grep -A1 t27

    # client half, the three layout defects
    grep -n "maxWidth: 160" <repo>/client.js   # hard-coded threshold
    grep -n "flexWrap" <repo>/client.js       # none in the new client
    grep -n "flexWrap" <repo>/legacy/client.js # 'wrap' in the legacy one

## PART 4 - the fix, landed and measured on the live page

### What changed (local repo, no remote)

Commits on `lane/narrow-layout` in
<repo>/.lane/narrow-layout:

| SHA | what it carries |
|---|---|
| a5a801b | the first narrow-layout law in `spec/gateway_ui.t27` + its application in `client.js` |
| a5290f8 | gap close: long-text wrap mode, toolbar wrap law, control min width |
| fce0ca9 | a source-grep test for the `narrow` identifier (superseded: a grep is not a contract test) |
| c0e5424 | the honest law (wrap at every width, no invented pixel threshold), the client fix and the real render test |

Landed into `master` of the same repo as merge commit `08ef0b0`
("merge narrow-layout lane: the gateway panel cannot paint outside its box").
The repo is local-only: no remote, no upstream PR, nothing pushed.

The law now lives entirely in `spec/gateway_ui.t27`:
`TOOLBAR_FLEX_WRAP_MODE`, `LONG_TEXT_WRAP_MODE`, `PANEL_PADDING_PX`,
`TOOLBAR_GAP_PX`, `TOOLBAR_CONTROL_MAX_PX`, `TOOLBAR_CONTROL_MIN_PX`,
`TOOLBAR_INPUT_BASIS_PX`, `INPUT_MIN_WIDTH_PX`. `client.js` reads only those
generated values.

One design decision worth stating: the lane's first version used a pixel
threshold (480 px) to decide whether the toolbar wraps. It was REMOVED on
purpose. The width at which the four controls fit depends on the HOST's font
metrics (the width of the button text), which no spec can measure; a wrong
threshold either overflows the panel or wraps a row that would have fitted.
The law now allows wrapping at every width and lets CSS decide where the break
happens. The consequence in the live page is that the four controls stack on
four lines in a 179 px content box - tall, but inside the panel.

A second defect was found and fixed on the way: commit a5290f8 removed
`const narrow = ui.is_narrow(widthPx)` while `client.js` still read `narrow`
in the state line. That is a runtime `ReferenceError: narrow is not defined`
in the state-absent view, which is exactly the state the panel lives in now.
`node --check` passes on such a file, so only a real render catches it. The
new test `test/gateway_client.test.mjs` executes `client.js` in a `node:vm`
sandbox with a React hook stub and renders the panel.

### Test numbers

- `sh scripts/build.sh` in the lane worktree: exit 0.
- `node --test test/*.test.mjs` in the lane worktree: 24 tests, 24 pass, 0 fail.
- `sh scripts/build.sh` in the landed master checkout: exit 0; 39 tests,
  39 pass, 0 fail (the master checkout also carries the HTTP-layer tests).
- `spec/gateway_ui.t27` test blocks: 18.
- `git diff --check`: clean.

Red/green proof of the new client test (real output, the file was restored
byte-identically afterwards):

    # red 1 - the original defect reintroduced
    not ok 1 - the panel renders at a narrow width without throwing
      error: 'narrow is not defined'
      name: 'ReferenceError'
    # tests 6 / # pass 0 / # fail 6

    # red 2 - a different missing binding (not one spelling of one bug)
    not ok 1 - the panel renders at a narrow width without throwing
      error: 'countersLine is not defined'
      name: 'ReferenceError'

    # green
    ok 1 - the panel renders at a narrow width without throwing
    ok 2 - the toolbar row is allowed to wrap, so no width can make it paint outside
    ok 3 - the long source path breaks with the generated mode instead of overflowing
    ok 4 - the toolbar controls carry the generated min and max widths
    ok 5 - the panel root uses the generated padding, so the content box is the law
    ok 6 - the narrow column hides still follow the generated narrow law
    # tests 6 / # pass 6 / # fail 0

### Delivery to the live page

The rebuilt `client.js` was installed into the live profile by rebuilding the
master checkout, which the profile symlink points at:

    sha256 client.js
    live checkout : 5e47d216ac5bac468bd171c8cd7cce6672fd75c8519ef881cba35eedb30603de
    live profile  : 5e47d216ac5bac468bd171c8cd7cce6672fd75c8519ef881cba35eedb30603de  (same)

That alone was NOT enough. The DSH server memoises a plugin bundle on its
first request (`packages/client/modules/src/index.ts`: `lazyBody` keeps the
produced buffer, and the chunk route only accepts the revision the server
computed at startup). The running server (pid 88005, started 11:41) therefore
kept serving the old bytes. The owner approved the restart on 2026-11-26; the
process was restarted with the same command and the same provider environment
(5 NVIDIA keys from ~/.dsh/nvidia-local.env, 4 OpenAI/OpenRouter exports from
~/.zshrc, no value printed). New pid 93198 listens on 127.0.0.1:3081 and the
log line `[llm-pi-ai] ... provider: 'nvidia' ... apiKeyPresent: true` confirms
the provider came back.

### Before / after on the live page (BrowserOS neo, viewport 450x799)

Before (page 52, old bundle) vs after (page 55, new bundle, same viewport):

| node                              | BEFORE width/scrollWidth | AFTER width/scrollWidth |
|-----------------------------------|--------------------------|-------------------------|
| PANEL ROOT                        | 203 / 407 (overflow 204) | 203 / 203 (overflow 0)   |
| panel toolbar row                 | 179 / 395, nowrap        | 179 / 179, flex-wrap wrap |
| toolbar select #1                 | 144                       | 144 (min 60, max 160)    |
| toolbar select #2                 | 91                        | 91 (min 60, max 160)     |
| toolbar input                     | 88                        | 168 (min 80, max 160)    |
| toolbar button "Retry"            | 49                        | 49                       |
| detail line (source path)         | 179 / 214                 | 179 / 179                |
| state line                        | 179 / 214                 | 179 / 179                |
| long path break mode              | overflow-wrap normal      | overflow-wrap anywhere, white-space normal |
| panel paint over the "54%" chip   | 204 px                    | 0 px (panel right 351, chip left 363) |

The panel now occupies 205x435 px inside the dock slot and paints nothing
outside its own box. The screenshot of the live page shows the path broken
over four lines, the controls stacked, and the neighbouring "54%" chip intact
to the right of the panel.

### Verdict on the audit counters - unchanged, and still separate

The layout fix does NOT move the counters, and it was never supposed to. The
counters read zero because there is no audit producer on this machine:
`tri-mcp` (the writer, t27 master `d04074a72`) is not built, and the live DSH
profile starts a DIFFERENT MCP server (`@local/t27-mcp` ->
`node <t27-checkout>-mcp/server.mjs`, 23 read-only tools, no gateway.* tools
and no audit sink). Even after building `tri-mcp`, the two path anchors still
disagree: the producer resolves the repo root from the process CWD, the panel
resolves from the package directory. The only bridge today is the
`T27_GATEWAY_AUDIT_PATH` env override, which the live process does not set.

So the panel is truthful: "Audit source not present -- <path>" with zero
counters is the fail-closed state, not a counting bug.

## PART 5 - published to GitHub for installation on another machine

Repository: **https://github.com/gHashTag/t27-gateway-panel** (PUBLIC, default
branch `master`). Created 2026-11-26 on the owner's order ("save everything to
GitHub so it can be installed on another machine").

Commits on `master`:

| SHA | what it carries |
|---|---|
| 08ef0b0 | merge of the narrow-layout lane into master |
| a0066f1 | publish: build products committed, README install procedure, docs/diagnosis-2026-11-26.md |
| 88370e8 | docs: the install command needs its required `--profile` flag |

Secret scan before publishing: `gitleaks detect` over the whole history
(9 commits at the time, no leaks) plus a targeted pattern scan for API keys,
GitHub tokens, AWS keys, Slack tokens and JWTs over every tracked file - no
match. The repository carries no credential.

What made the git install possible: `generated/gateway_logic.mjs`,
`generated/gateway_ui.mjs` and `client.gateway_ui.js` are BUILD PRODUCTS
(written only by `scripts/build.sh`), and they are now committed, because a
git dependency has to work on a machine that has no `t27c` toolchain. They
are still never hand-written, and the contract tests read the generated
modules, so a stale artifact fails the suite.

Verification of the published state (fresh clone, no build step, no t27c):

    $ git clone https://github.com/gHashTag/t27-gateway-panel.git clone-check
    $ cd clone-check && node --test test/*.test.mjs
    # tests 39
    # pass 39
    # fail 0

    $ npm pack --dry-run
    21 files, 29.3 kB tarball, including bridge/, generated/, scripts/, spec/
    and client.gateway_ui.js

Install procedure (documented in the repository README):

    git clone https://github.com/gHashTag/t27-gateway-panel.git
    cd t27-gateway-panel && node --test test/*.test.mjs    # optional self-check
    dsh plugin --profile <profile> add link:/absolute/path/to/t27-gateway-panel
    # or straight from GitHub:
    dsh plugin --profile <profile> add github:gHashTag/t27-gateway-panel

plus the three profile rows the plugin needs: the dependency in
`<profile>/package.json` (written by the plugin manager), `"@local/t27-gateway"`
in `dsh.profile.bundles`, and `- id: t27-gateway` in
`<profile>/cordis.patch.yml`; and a restart of the DSH web process, because
the server memoises a plugin bundle on its first request.

Not published: a concurrent session was editing `spec/gateway_ui.t27` in the
same working tree at publication time (a "compact dock law" declaring
`DEFAULT_EXPANDED`, `LABEL_EXPAND`, `LABEL_COLLAPSE`, written at 20:39 while
the session was publishing). That edit is INCOMPLETE - no client code and no
generated artifact consumes it - so it was left uncommitted and untouched in
the working tree, and it is NOT in the published repository. The lane that owns
it commits and pushes it when it is finished.
