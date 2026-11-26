// Contract tests for the UI artifact (generated/gateway_ui.mjs).
// gen-js lowers scalars only, so the pinned surface is the scalar law: state
// kinds, the row cap, the narrow bound, badge labels and token NAMES, and the
// option/label lists the client composes with. Object assembly lives in the
// client as the documented platform-bridge exception; these tests pin every
// value it is allowed to consume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VIEW_MAX_ROWS,
  NARROW_MAX_WIDTH_PX,
  TOOL_OPTIONS,
  DECISION_OPTIONS,
  LABEL_TITLE,
  LABEL_RETRY,
  LABEL_EMPTY,
  LABEL_ERROR,
  LABEL_SOURCE_ABSENT,
  LABEL_COUNTERS_TEMPLATE,
  LABEL_DROPPED_TEMPLATE,
  LABEL_TOOL_ALL,
  LABEL_DECISION_ALL,
  BADGE_TOKEN_ALLOW,
  BADGE_TOKEN_DENY,
  STYLE_TOKEN_TEXT_SECONDARY,
  STYLE_TOKEN_BORDER,
  STYLE_TOKEN_BG,
  is_narrow,
  visible_row_count,
  resolve_state_kind,
  state_detail,
  badge_label,
  badge_color_token,
  derive_content_width,
  toolbar_wraps,
} from '../generated/gateway_ui.mjs';

// State kinds as the spec defines them: 0 ready, 1 error, 2 source-absent,
// 3 empty. The client maps these to labels with the same constants, so the
// four kinds must stay pairwise distinct.
const KIND_READY = 0;
const KIND_ERROR = 1;
const KIND_SOURCE_ABSENT = 2;
const KIND_EMPTY = 3;

test('state law: failure, absent source, empty and ready are four distinct kinds', () => {
  assert.equal(resolve_state_kind(false, false, 0), KIND_ERROR);
  assert.equal(resolve_state_kind(true, false, 0), KIND_SOURCE_ABSENT);
  assert.equal(resolve_state_kind(true, true, 0), KIND_EMPTY);
  assert.equal(resolve_state_kind(true, true, 2), KIND_READY);
  const distinct = new Set([
    resolve_state_kind(false, false, 0),
    resolve_state_kind(true, false, 0),
    resolve_state_kind(true, true, 0),
    resolve_state_kind(true, true, 2),
  ]);
  assert.equal(distinct.size, 4);
});

test('source-absent detail carries the path; ready detail is empty', () => {
  const detail = state_detail(KIND_SOURCE_ABSENT, 200, '/tmp/missing.log');
  assert.equal(detail, '/tmp/missing.log');
  assert.notEqual(detail.includes('/tmp/missing.log'), false);
  assert.equal(state_detail(KIND_READY, 200, '/tmp/here.log'), '');
});

test('error detail names the transport, never a fake empty state', () => {
  const http = state_detail(KIND_ERROR, 404, '/tmp/here.log');
  const gateway = state_detail(KIND_ERROR, 200, '/tmp/here.log');
  for (const detail of [http, gateway]) {
    assert.equal(typeof detail, 'string');
    assert.equal(detail.length > 0, true);
    assert.notEqual(detail, '/tmp/here.log');
  }
  assert.notEqual(http, gateway);
});

test('rows are capped at VIEW_MAX_ROWS; below the cap every row survives', () => {
  assert.equal(VIEW_MAX_ROWS, 12);
  assert.equal(visible_row_count(0), 0);
  assert.equal(visible_row_count(5), 5);
  assert.equal(visible_row_count(VIEW_MAX_ROWS), VIEW_MAX_ROWS);
  assert.equal(visible_row_count(40), VIEW_MAX_ROWS);
});

test('narrow boundary uses strict < per spec', () => {
  // Spec: width_px < NARROW_MAX_WIDTH_PX — strict less-than.
  assert.equal(is_narrow(NARROW_MAX_WIDTH_PX - 1), true);
  assert.equal(is_narrow(NARROW_MAX_WIDTH_PX), false);
  assert.equal(is_narrow(NARROW_MAX_WIDTH_PX + 1), false);
  assert.equal(is_narrow(0), true, 'an unmeasured panel is narrow until proven wide');
});

test('content width derives from root minus padding', () => {
  assert.equal(derive_content_width(203), 179);
  assert.equal(derive_content_width(395), 371);
  assert.equal(derive_content_width(503), 479);
});

test('toolbar wraps when narrow', () => {
  assert.equal(toolbar_wraps(479), true);
  assert.equal(toolbar_wraps(480), false);
  assert.equal(toolbar_wraps(390), true);
  assert.equal(toolbar_wraps(800), false);
});

test('every generated string the client renders is a token name or a label, never a literal color', () => {
  const rendered = [
    LABEL_TITLE,
    LABEL_RETRY,
    LABEL_EMPTY,
    LABEL_ERROR,
    LABEL_SOURCE_ABSENT,
    LABEL_COUNTERS_TEMPLATE,
    LABEL_DROPPED_TEMPLATE,
    LABEL_TOOL_ALL,
    LABEL_DECISION_ALL,
    BADGE_TOKEN_ALLOW,
    BADGE_TOKEN_DENY,
    STYLE_TOKEN_TEXT_SECONDARY,
    STYLE_TOKEN_BORDER,
    STYLE_TOKEN_BG,
  ].join('|');
  assert.equal(rendered.includes('#'), false, 'a hex color leaked into the UI law');
  assert.equal(rendered.includes('rgb('), false, 'an rgb() color leaked into the UI law');
  for (const token of [STYLE_TOKEN_TEXT_SECONDARY, STYLE_TOKEN_BORDER, STYLE_TOKEN_BG]) {
    assert.equal(token.startsWith('--dsw-'), true);
  }
});

test('counter and dropped templates keep the exact placeholders the client substitutes', () => {
  for (const placeholder of ['{allow}', '{deny}', '{denyRate}', '{total}']) {
    assert.equal(LABEL_COUNTERS_TEMPLATE.includes(placeholder), true, `missing ${placeholder}`);
  }
  assert.equal(LABEL_DROPPED_TEMPLATE.includes('{dropped}'), true);
  // Substitution over the generated template must not leave raw braces behind.
  const countersLine = LABEL_COUNTERS_TEMPLATE
    .replace('{allow}', '3')
    .replace('{deny}', '1')
    .replace('{denyRate}', '0')
    .replace('{total}', '4');
  assert.equal(countersLine.includes('{'), false);
});

test('choice lists offer more than the single current choice', () => {
  // All + the four audit producers: an option that can never match is a lie.
  assert.equal(TOOL_OPTIONS.length, 5);
  assert.deepEqual([...TOOL_OPTIONS].slice(1), [
    'cdp.observe',
    'dsh.status',
    'gateway.status',
    'gateway.policy.audit',
  ]);
  assert.equal(TOOL_OPTIONS[0], LABEL_TOOL_ALL);
  assert.equal(DECISION_OPTIONS.length, 4);
  assert.equal(DECISION_OPTIONS[0], LABEL_DECISION_ALL);
  assert.equal(LABEL_RETRY.length > 0, true);
  assert.equal(LABEL_TITLE.length > 0, true);
});