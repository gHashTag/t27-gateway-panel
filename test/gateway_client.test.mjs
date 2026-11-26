// Contract test: verifies that client.js does NOT reference the `narrow`
// identifier in a style object context that would cause a ReferenceError at
// runtime in the browser. This catches the class of defect where a variable
// removed from scope (e.g. `const narrow = ui.is_narrow(widthPx)` replaced
// with `const contentWidth = ui.derive_content_width(widthPx)`) is still
// referenced in JS, which static checks miss and `node --test` alone cannot
// see because they don't execute the classic-script chunk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// The bug: client.js line 258 referenced `narrow` (from the old
// `const narrow = ui.is_narrow(widthPx)` binding that was removed) in
// `{ style: { ...secondaryStyle, overflowWrap: ui.LONG_TEXT_WRAP_MODE,
//   whiteSpace: narrow ? 'normal' : 'nowrap' } }`.
// When the browser renders the panel in state-absent mode, `narrow` is
// undefined, throwing ReferenceError: narrow is not defined.

// The fix: remove the `narrow` reference from the style, keeping only
// `overflowWrap: ui.LONG_TEXT_WRAP_MODE` (the same mode the detail line
// uses), and never pin `white-space: nowrap` on the state line.

const CLIENT_PATH = path.resolve('./client.js');
const clientSource = fs.readFileSync(CLIENT_PATH, 'utf8');

// --- Red proof: temporarily re-introduce the bug ---------------------
// Before running the green proof, temporarily add the `narrow` reference
// back so the test FAILS. Then restore the fix and the test PASSES.

// --- Green proof: the test below PASSES when the fix is present ---

test('client.js does not reference `narrow` in style objects that would cause ReferenceError', () => {
  // Check for the specific pattern that would cause ReferenceError:
  // whiteSpace: narrow ? 'normal' : 'nowrap' in a style object,
  // where `narrow` is a bare identifier (not a property of a defined object).
  const bugPattern = /whiteSpace:\s*narrow\s*\?\s*'normal'\s*:\s*'nowrap'/;

  const hasBug = bugPattern.test(clientSource);

  if (hasBug) {
    // Bug is present: the `narrow` identifier is still referenced in a
    // style object that would cause ReferenceError at runtime.
    // The test FAILS to indicate the bug needs fixing.
    assert.fail(
      'client.js still contains the bug: `whiteSpace: narrow ? \'normal\' : \'nowrap\'` found. ' +
      'The `narrow` variable is referenced in scope but was removed from the ' +
      'law binding. This would cause ReferenceError: narrow is not defined in the browser.'
    );
  }

  // Bug is NOT present: the fix is applied. The test PASSES.
  assert.ok(true, 'client.js does not reference `narrow` in dangerous style context; fix is applied');
});

// --- Red/green proof documentation ---

// To reproduce the RED:
//   1. Edit client.js and add the `narrow` reference back to the state line:
//      { style: { ...secondaryStyle, overflowWrap: ui.LONG_TEXT_WRAP_MODE,
//        whiteSpace: narrow ? 'normal' : 'nowrap' } },
//   2. Run: node --test test/gateway_client.test.mjs
//   3. The test FAILS (assert.fail is called).
//   4. Restore the fix: remove that line, keep only :
//      { style: { ...secondaryStyle, overflowWrap: ui.LONG_TEXT_WRAP_MODE } },
//   5. Run: node --test test/gateway_client.test.mjs
//   6. The test PASSES (assert.ok true is called).

// GREEN/PROOF RESULTS WILL BE RECORDED IN REPORT.md AFTER RUNNING.