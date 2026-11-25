// Contract tests for the UI artifact (generated/gateway_ui.mjs).
// These pin the viewmodel interface between spec and client BEFORE the spec
// exists; they are red until scripts/build.sh produces the artifact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEW_MAX_ROWS,
  resolvePanelState,
  buildViewModel,
  LABEL_RETRY,
  TOOL_OPTIONS,
  DECISION_OPTIONS,
} from '../generated/gateway_ui.mjs';

const EVENTS = [
  { ts: 1762798000, actor: 'queen', tool: 'cdp.observe', scope: '9222', decision: 0, reason: 0, requestHash: '2854501129' },
  { ts: 1762798005, actor: 'bee-7', tool: 'dsh.status', scope: '3081', decision: 1, reason: 12, requestHash: '193827144' },
];

const READY_INPUT = {
  state: 'ready',
  events: EVENTS,
  counters: { allow: 1, deny: 1, denyRate: 0, total: 2 },
  dropped: 0,
  filter: { tool: null, decision: null, text: null },
  widthPx: 800,
};

test('fetch failure maps to error, never to a fake empty state', () => {
  const vm = resolvePanelState({ ok: false, status: 404 });
  assert.equal(vm.state, 'error');
  assert.equal(typeof vm.detail, 'string');
  assert.notEqual(vm.state, 'empty');
});

test('absent source is its own state, distinct from empty', () => {
  const absent = resolvePanelState({
    ok: true,
    payload: { source: { present: false, path: '/x', reason: 'absent' }, events: [], total: 0, dropped: 0 },
  });
  assert.equal(absent.state, 'source-absent');
  assert.equal(absent.detail.includes('/x'), true);
});

test('zero events is empty; non-empty is ready', () => {
  assert.equal(resolvePanelState({ ok: true, payload: { source: { present: true }, events: [], total: 0, dropped: 0 } }).state, 'empty');
  assert.equal(resolvePanelState({ ok: true, payload: { source: { present: true }, events: EVENTS, total: 2, dropped: 0 } }).state, 'ready');
});

test('rows are capped at VIEW_MAX_ROWS and every badge color is a token name', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ ...EVENTS[0], ts: 1762798000 + i }));
  const vm = buildViewModel({ ...READY_INPUT, events: many });
  assert.equal(vm.rows.length <= VIEW_MAX_ROWS, true);
  assert.equal(vm.rows.length, VIEW_MAX_ROWS);
  for (const row of vm.rows) {
    assert.equal(row.badge.colorToken.startsWith('--dsw-'), true);
    assert.equal(typeof row.badge.label, 'string');
  }
});

test('narrow width hides the scoped cells instead of overflowing', () => {
  const wide = buildViewModel(READY_INPUT);
  const narrow = buildViewModel({ ...READY_INPUT, widthPx: 390 });
  assert.equal(wide.narrow, false);
  assert.equal(narrow.narrow, true);
  for (const row of narrow.rows) {
    for (const cell of row.cells) assert.notEqual(cell.hideWhenNarrow, true);
  }
  // The hidden cells must EXIST in the wide model (they exist and are dropped).
  assert.equal(wide.rows[0].cells.some(c => c.hideWhenNarrow === true), true);
});

test('no hardcoded colors anywhere in the viewmodel', () => {
  const vm = buildViewModel(READY_INPUT);
  const text = JSON.stringify(vm);
  assert.equal(text.includes('#'), false, 'hex color leaked into the viewmodel');
  assert.equal(text.includes('rgb('), false, 'rgb() leaked into the viewmodel');
});

test('choice lists offer more than the single current choice', () => {
  assert.equal(TOOL_OPTIONS.length, 11); // All tools + 10 gateway tools
  assert.equal(DECISION_OPTIONS.length, 4); // All + ALLOW + DENY + DENY RATE
  assert.equal(LABEL_RETRY.length > 0, true);
});
