#!/bin/sh
# Builds the generated .mjs artifacts from the .t27 specs, then runs the tests.
# Generated artifacts are never hand-copied: this script is their only writer.
# Run from anywhere; paths resolve against the package root.
set -e
cd "$(dirname "$0")/.."
T27C="${T27C:-/Users/playra/.cargo/bin/t27c}"

# `test` only lists test blocks; `test-report` runs them. Spec-level gate:
# `t27c check <spec>` (exit 0 = clean). `t27c gates` is a check_*.py tree
# runner and takes no spec path -- do not route a single spec through it.
"$T27C" check spec/gateway_logic.t27
"$T27C" test-report spec/gateway_logic.t27

# gen-js 0.5.2 emits data, never code (see the PLATFORM BRIDGE header in
# spec/gateway_logic.t27): the artifact is the emitted data followed by the
# marked composition section. The bridge owns no rule of its own -- every
# threshold, table and reason string it uses is read from the emitted consts.
# The bridge text lives in ONE home, bridge/gateway_logic_bridge.mjs; it is a
# build input concatenated here, not a runtime module (its identifiers resolve
# only inside the assembled artifact). Once the backend lowers indexed bodies,
# drop this append step: the emitted fns replace the bridge under the same API.
"$T27C" gen-js spec/gateway_logic.t27 > generated/gateway_logic.mjs

if [ ! -f bridge/gateway_logic_bridge.mjs ]; then
  echo "build: missing bridge/gateway_logic_bridge.mjs" >&2
  exit 1
fi
cat bridge/gateway_logic_bridge.mjs >> generated/gateway_logic.mjs

# spec/gateway_ui.t27 belongs to the panel-UI half of the migration and may
# not exist yet; gate the UI steps on its presence instead of failing here.
# It is gated AFTER the logic artifact is rebuilt above, so a spec that does
# not compile never blocks regenerating the logic half it shares nothing with.
# A UI gate failure is recorded, not swallowed: its artifact is left as-is
# (the contract test fails loudly on a stale one) and the build exits nonzero.
UI_STATUS=0
if [ -f spec/gateway_ui.t27 ]; then
  if "$T27C" check spec/gateway_ui.t27; then
    "$T27C" test-report spec/gateway_ui.t27
    "$T27C" gen-js spec/gateway_ui.t27 > generated/gateway_ui.mjs
    # The browser chunk loader only takes client.<name>.js CLASSIC scripts;
    # the ESM artifact is lowered mechanically by the emitter (it refuses a
    # non-empty __NOT_EMITTED__, so a half-emitted law never ships).
    node scripts/emit_client_gateway_ui.mjs
  else
    echo "build: spec/gateway_ui.t27 failed its check gate; generated/gateway_ui.mjs left as-is" >&2
    UI_STATUS=1
  fi
fi

# Node 22 on this machine does not accept a bare directory as a --test target;
# list the test files explicitly so every contract test actually runs.
TEST_STATUS=0
node --test test/*.test.mjs || TEST_STATUS=1

exit $((UI_STATUS + TEST_STATUS))
