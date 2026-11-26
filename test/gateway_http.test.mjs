// Tests for the HTTP layer of the t27 gateway panel host half.
// These drive the REAL handlers registered by apply(ctx) against a recording
// fake ctx, so the auth-first ordering, the 405, the 400 on an unknown decision
// label, the server-side generated filterEvents application and the
// counters-over-the-filtered-set contract are measured, not assumed.
// Red until `sh scripts/build.sh` has produced the generated artifacts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DECISION_OPTIONS } from '../generated/gateway_ui.mjs';
import { apply, AUDIT_PATH, HEALTH_PATH } from '../index.js';

const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures');

// --- recording fakes ---------------------------------------------------------

// The fake connection parses the request it was given (a per-request flag);
// it holds no auth rule of its own. The handler under test owns the rule.
function makeCtx() {
  const registered = new Map();
  const ctx = {
    connection: {
      requestRejection(req) {
        return req.authRejected === true ? 401 : undefined;
      },
    },
    webServer: {
      register(desc) {
        registered.set(desc.path, desc);
        return desc;
      },
    },
    effect(fn) {
      fn();
    },
  };
  apply(ctx);
  return registered;
}

function makeReq(url, { method = 'GET', authRejected = false } = {}) {
  return { url, method, authRejected };
}

function makeRes() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    body: null,
    ended: false,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(payload) {
      this.body = payload ?? '';
      this.ended = true;
    },
  };
}

function serveAudit(payload) {
  const res = makeRes();
  const registered = makeCtx();
  registered.get(AUDIT_PATH).handler(payload.req, res);
  return res;
}

function serveHealth(req) {
  const res = makeRes();
  const registered = makeCtx();
  registered.get(HEALTH_PATH).handler(req, res);
  return res;
}

function withLog(logPath, fn) {
  const before = process.env.T27_GATEWAY_AUDIT_PATH;
  process.env.T27_GATEWAY_AUDIT_PATH = logPath;
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.T27_GATEWAY_AUDIT_PATH;
    else process.env.T27_GATEWAY_AUDIT_PATH = before;
  }
}

const VALID = path.join(FIXTURES, 'audit-valid.log');
const BAD = path.join(FIXTURES, 'audit-bad.log');
const MISSING = path.join(FIXTURES, 'no-such-file.log');

// --- registration ------------------------------------------------------------

test('both routes are registered as exact paths', () => {
  const registered = makeCtx();
  assert.equal(registered.size, 2);
  assert.equal(registered.get(AUDIT_PATH).kind, 'exact');
  assert.equal(registered.get(HEALTH_PATH).kind, 'exact');
});

// --- auth ordering -----------------------------------------------------------

test('a rejected request answers 401 before any payload is built', () => {
  withLog(VALID, () => {
    const res = serveAudit({ req: makeReq(AUDIT_PATH, { authRejected: true }) });
    assert.equal(res.statusCode, 401);
    assert.equal(res.ended, true);
    // Rejection happens BEFORE the JSON payload: no content-type is set and
    // the body stays empty even though the log file exists and parses.
    assert.equal('content-type' in res.headers, false);
    assert.equal(res.body, '');
  });
});

// --- happy path --------------------------------------------------------------

test('GET audit serves the full contract with counters over the whole tail', () => {
  withLog(VALID, () => {
    const res = serveAudit({ req: makeReq(AUDIT_PATH) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
    const payload = JSON.parse(res.body);
    assert.equal(payload.contractVersion, 1);
    assert.equal(payload.source.present, true);
    assert.equal(payload.total, 4);
    assert.equal(payload.dropped, 0);
    assert.equal(payload.events.length, 4);
    // The legacy contract served { lines }; it must never come back.
    assert.equal('lines' in payload, false);
    assert.deepEqual(payload.counters, { allow: 2, deny: 1, denyRate: 1, total: 4 });
  });
});

// --- method guard ------------------------------------------------------------

test('POST audit is refused with 405 and the one supported method', () => {
  withLog(VALID, () => {
    const res = serveAudit({ req: makeReq(AUDIT_PATH, { method: 'POST' }) });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'GET');
    assert.equal('content-type' in res.headers, false);
    assert.equal(res.body, '');
  });
});

// --- filtering is the generated law applied server-side ----------------------

test('tool filter narrows events and counters count only the filtered set', () => {
  withLog(VALID, () => {
    const res = serveAudit({ req: makeReq(AUDIT_PATH + '?tool=cdp.observe') });
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.events.length, 1);
    assert.equal(payload.events[0].tool, 'cdp.observe');
    assert.deepEqual(payload.counters, { allow: 1, deny: 0, denyRate: 0, total: 1 });
    // The unfiltered totals stay visible next to the filtered view.
    assert.equal(payload.total, 4);
  });
});

test('decision label ALLOW maps to code 0 through the generated list', () => {
  withLog(VALID, () => {
    const res = serveAudit({ req: makeReq(AUDIT_PATH + '?decision=ALLOW') });
    const payload = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(payload.events.length, 2);
    for (const event of payload.events) assert.equal(event.decision, 0);
    assert.deepEqual(payload.counters, { allow: 2, deny: 0, denyRate: 0, total: 2 });
  });
});

test('decision label DENY keeps reason-bearing rows apart from DENY RATE', () => {
  withLog(VALID, () => {
    const res = serveAudit({ req: makeReq(AUDIT_PATH + '?decision=DENY') });
    const payload = JSON.parse(res.body);
    assert.equal(payload.events.length, 1);
    assert.equal(payload.events[0].decision, 1);
    assert.equal(payload.events[0].reason, 12);
    assert.deepEqual(payload.counters, { allow: 0, deny: 1, denyRate: 0, total: 1 });
  });
});

test('decision label DENY RATE reaches decision code 2, not DENY', () => {
  withLog(VALID, () => {
    const res = serveAudit({ req: makeReq(AUDIT_PATH + '?decision=' + encodeURIComponent('DENY RATE')) });
    const payload = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(payload.events.length, 1);
    assert.equal(payload.events[0].decision, 2);
    assert.equal(payload.events[0].reason, 255);
    assert.deepEqual(payload.counters, { allow: 0, deny: 0, denyRate: 1, total: 1 });
  });
});

test('filters combine with AND semantics and an empty match is honest zero', () => {
  withLog(VALID, () => {
    const res = serveAudit({ req: makeReq(AUDIT_PATH + '?tool=dsh.status&decision=ALLOW') });
    const payload = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(payload.events, []);
    assert.deepEqual(payload.counters, { allow: 0, deny: 0, denyRate: 0, total: 0 });
  });
});

test('text filter is a case-insensitive substring over actor or tool', () => {
  withLog(VALID, () => {
    const upper = serveAudit({ req: makeReq(AUDIT_PATH + '?text=QUEEN') });
    const payload = JSON.parse(upper.body);
    assert.equal(payload.events.length, 2);
    for (const event of payload.events) assert.equal(event.actor, 'queen');
    const byTool = serveAudit({ req: makeReq(AUDIT_PATH + '?text=status') });
    const byToolPayload = JSON.parse(byTool.body);
    assert.equal(byToolPayload.events.length, 2);
    assert.equal(byToolPayload.events[0].tool, 'dsh.status');
    assert.equal(byToolPayload.events[1].tool, 'gateway.status');
  });
});

test('an empty decision parameter means no filter, not a 400', () => {
  withLog(VALID, () => {
    const res = serveAudit({ req: makeReq(AUDIT_PATH + '?decision=') });
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.events.length, 4);
  });
});

// --- unknown label is refused, not silently ignored --------------------------

test('an unknown decision label is a 400 naming the generated option list', () => {
  withLog(VALID, () => {
    const res = serveAudit({ req: makeReq(AUDIT_PATH + '?decision=MAYBE') });
    assert.equal(res.statusCode, 400);
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    const payload = JSON.parse(res.body);
    assert.equal(payload.error, 'invalid decision filter');
    // The expected list comes from the generated artifact, never a hand copy.
    assert.deepEqual(payload.expected, [...DECISION_OPTIONS]);
    assert.equal(payload.expected.length, 4);
  });
});

// --- malformed log through the HTTP layer ------------------------------------

test('dropped malformed lines are reported through the HTTP layer too', () => {
  withLog(BAD, () => {
    const res = serveAudit({ req: makeReq(AUDIT_PATH) });
    const payload = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(payload.total, 1);
    assert.equal(payload.dropped, 3);
    assert.equal(payload.events.length, 1);
    assert.deepEqual(payload.counters, { allow: 1, deny: 0, denyRate: 0, total: 1 });
  });
});

// --- health route ------------------------------------------------------------

test('health reports five checks and the absent-log anomaly by name', () => {
  withLog(VALID, () => {
    const ok = serveHealth(makeReq(HEALTH_PATH));
    const okPayload = JSON.parse(ok.body);
    assert.equal(ok.statusCode, 200);
    assert.equal(okPayload.contractVersion, 1);
    assert.equal(okPayload.checks.length, 5);
    assert.equal(okPayload.checks[0].ok, true);
    assert.deepEqual(okPayload.anomalies, []);
  });
  withLog(MISSING, () => {
    const absent = serveHealth(makeReq(HEALTH_PATH));
    const absentPayload = JSON.parse(absent.body);
    assert.equal(absentPayload.checks[0].ok, false);
    assert.deepEqual(absentPayload.anomalies, ['audit log absent']);
  });
});

test('POST health is refused with 405 like the audit route', () => {
  withLog(VALID, () => {
    const res = serveHealth(makeReq(HEALTH_PATH, { method: 'POST' }));
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'GET');
  });
});
