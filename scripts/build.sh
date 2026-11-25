#!/bin/sh
# Builds the generated .mjs artifacts from the .t27 specs, then runs the tests.
# Generated artifacts are never hand-copied: this script is their only writer.
# Run from anywhere; paths resolve against the package root.
set -e
cd "$(dirname "$0")/.."
T27C="${T27C:-/Users/playra/.cargo/bin/t27c}"

"$T27C" test-report spec/gateway_logic.t27
"$T27C" test-report spec/gateway_ui.t27
"$T27C" gen-js spec/gateway_logic.t27 > generated/gateway_logic.mjs
"$T27C" gen-js spec/gateway_ui.t27 > generated/gateway_ui.mjs

node --test test/
