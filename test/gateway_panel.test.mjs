// Tests for the t27 gateway panel host half (audit tail contract).
// Red until `sh scripts/build.sh` has produced generated/gateway_logic.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readAuditTail, findAuditLog, AUDIT_PATH, HEALTH_PATH, AUDIT_TAIL_LINES } from '../index.js';

const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');

test('routes are the documented exact paths', () => {
  assert.equal(AUDIT_PATH, '/api/t27-gateway/audit');
  assert.equal(HEALTH_PATH, '/api/t27-gateway/health');
});

test('valid audit log parses into the exact seven-field events', () => {
  const tail = readAuditTail(path.join(FIXTURES, 'audit-valid.log'));
  assert.equal(tail.source.present, true);
  assert.equal(tail.total, 4);
  assert.equal(tail.dropped, 0);
  assert.equal(tail.events.length, 4);
  assert.deepEqual(tail.events[0], {
    ts: 1762798000,
    actor: 'queen',
    tool: 'cdp.observe',
    scope: '9222',
    decision: 0,
    reason: 0,
    requestHash: '2854501129',
  });
  assert.equal(tail.events.at(-1).tool, 'gateway.policy.audit');
});

test('DENY_RATE (decision 2) is kept, not confused with DENY', () => {
  // Regression: the legacy client knew only decisions 0 and 1.
  const tail = readAuditTail(path.join(FIXTURES, 'audit-valid.log'));
  const rate = tail.events.filter(e => e.decision === 2);
  assert.equal(rate.length, 1);
  assert.equal(rate[0].tool, 'gateway.status');
});

test('law-hostile lines are dropped fail-closed, clean ones survive', () => {
  const tail = readAuditTail(path.join(FIXTURES, 'audit-bad.log'));
  assert.equal(tail.total, 1);
  assert.equal(tail.dropped, 3);
  assert.equal(tail.events.length, 1);
  assert.equal(tail.events[0].tool, 'cdp.observe');
});

test('absent log is honest absence, not an empty success', () => {
  const tail = readAuditTail(path.join(FIXTURES, 'no-such-file.log'));
  assert.equal(tail.source.present, false);
  assert.equal(tail.source.reason, 'absent');
  assert.deepEqual(tail.events, []);
  assert.equal(tail.total, 0);
  assert.equal(tail.dropped, 0);
  // Regression: the legacy host served { lines }; the client read { events }.
  assert.equal('lines' in tail, false);
  assert.equal('events' in tail, true);
});

test('tail bound holds and total still counts the whole file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 't27-gw-'));
  const lines = [];
  for (let i = 0; i < 250; i++) {
    lines.push(`${1762798000 + i}\tqueen\tgateway.status\t3081\t0\t0\t${1000000 + i}`);
  }
  const logPath = path.join(dir, 'gateway-audit.log');
  writeFileSync(logPath, lines.join('\n') + '\n');
  const tail = readAuditTail(logPath);
  assert.equal(tail.total, 250);
  assert.equal(tail.events.length, AUDIT_TAIL_LINES);
  assert.equal(tail.dropped, 0);
  assert.equal(tail.events.at(-1).ts, 1762798000 + 249);
});

test('audit location walks up from the package; env override wins', () => {
  const before = process.env.T27_GATEWAY_AUDIT_PATH;
  process.env.T27_GATEWAY_AUDIT_PATH = path.join(FIXTURES, 'audit-valid.log');
  try {
    assert.equal(findAuditLog(), path.join(FIXTURES, 'audit-valid.log'));
  } finally {
    if (before === undefined) delete process.env.T27_GATEWAY_AUDIT_PATH;
    else process.env.T27_GATEWAY_AUDIT_PATH = before;
  }
});
