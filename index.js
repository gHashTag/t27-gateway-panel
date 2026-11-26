// T27 gateway panel, Host half.
// Serves the gateway audit tail as JSON for the dashboard panel. The panel is a
// READER: it never writes the log, never spawns processes, never holds
// credentials. The audit log is located by walking up from this package
// directory to the checkout's .trinity directory so the package survives
// worktree relocation; T27_GATEWAY_AUDIT_PATH overrides the location for
// tests. The wire law (fields, decision codes, tail bounds) lives in the .t27
// spec and arrives here only as generated code; see generated/gateway_logic.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  AUDIT_TAIL_LINES,
  countByDecision,
  filterEvents,
  parseAuditLine,
} from './generated/gateway_logic.mjs';
// Decision labels are UI-law consts from the generated UI artifact; the host
// maps the query's label back to the law's decision code without inventing a
// copy of either list.
import { DECISION_OPTIONS } from './generated/gateway_ui.mjs';
// The pinned contract test imports the tail bound from the Host half, so the
// generated constant is re-exported here rather than read from the artifact.
export { AUDIT_TAIL_LINES };

const PKG_DIR = path.dirname(fileURLToPath(import.meta.url));

export const AUDIT_PATH = '/api/t27-gateway/audit';
export const HEALTH_PATH = '/api/t27-gateway/health';
const CONTRACT_VERSION = 1;

/** Cordis function-plugin name; the patch inserts this row id. */
export const name = 't27-gateway';
/** The route carrier and the trust fence guarding every route. */
export const inject = ['webServer', 'connection'];

/** Locate the gateway's own audit log; the env override exists for tests only. */
export function findAuditLog() {
  const override = process.env.T27_GATEWAY_AUDIT_PATH;
  if (override) return override;
  let dir = PKG_DIR;
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, '.trinity', 'gateway-audit.log');
    if (existsSync(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(PKG_DIR, '.trinity', 'gateway-audit.log');
}

/**
 * Parse the audit file into the panel contract. Absence is data, not an error:
 * the panel must be able to tell "gateway never ran here" apart from "ran and
 * wrote nothing". `total` counts law-clean lines over the WHOLE file, `dropped`
 * counts lines that failed the law; the response carries only the tail.
 */
export function readAuditTail(logPath) {
  let raw;
  try {
    raw = readFileSync(logPath, 'utf8');
  } catch {
    return {
      source: { path: logPath, present: false, reason: 'absent' },
      events: [],
      total: 0,
      dropped: 0,
    };
  }
  const lines = raw.split('\n').filter(line => line.length > 0);
  const parsed = lines.map(line => parseAuditLine(line));
  const events = parsed.filter(r => r.ok).map(r => r.event);
  const dropped = parsed.length - events.length;
  return {
    source: { path: logPath, present: true, reason: 'ok' },
    events: events.slice(-AUDIT_TAIL_LINES),
    total: events.length,
    dropped,
  };
}

/** JSON response, no-store: audit freshness is the whole point of the panel. */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

/** 405 with the route's one supported method. */
function sendMethodNotAllowed(res, method) {
  res.statusCode = 405;
  res.setHeader('allow', method);
  res.end();
}

export function apply(ctx) {
  /** 401/403 before any payload; same trust idiom as open-in-app. */
  const rejected = (req, res) => {
    const connection = Reflect.get(ctx, 'connection');
    const rejection = connection?.requestRejection(req);
    if (rejection === undefined) return false;
    res.statusCode = rejection;
    res.end();
    return true;
  };

  const serveAudit = (req, res) => {
    if (rejected(req, res)) return;
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    const tail = readAuditTail(findAuditLog());
    // Filtering is the generated law applied SERVER-SIDE (filterEvents): the
    // client sends raw query parameters and owns no rule of its own. A
    // decision label outside the generated list is refused (400) instead of
    // being silently dropped, so the panel can never show an unfiltered view
    // while believing it is filtered.
    const url = new URL(req.url, 'http://127.0.0.1');
    const toolParam = url.searchParams.get('tool');
    const decisionParam = url.searchParams.get('decision');
    const textParam = url.searchParams.get('text');
    let decisionCode = null;
    if (decisionParam !== null && decisionParam !== '' && decisionParam !== DECISION_OPTIONS[0]) {
      decisionCode = DECISION_OPTIONS.indexOf(decisionParam) - 1;
      if (decisionCode < 0) {
        return sendJson(res, 400, {
          error: 'invalid decision filter',
          expected: DECISION_OPTIONS,
        });
      }
    }
    const filter = {
      tool: toolParam === null || toolParam === '' ? null : toolParam,
      decision: decisionCode,
      text: textParam === null || textParam === '' ? null : textParam,
    };
    const events = filterEvents(tail.events, filter);
    sendJson(res, 200, {
      contractVersion: CONTRACT_VERSION,
      source: tail.source,
      total: tail.total,
      dropped: tail.dropped,
      events,
      // Decision counters over the SAME filtered events the panel renders
      // (not the whole file): the view model must never claim more than it
      // shows. Counting is the generated countByDecision, not a hand tally.
      counters: countByDecision(events),
    });
  };

  const serveHealth = (req, res) => {
    if (rejected(req, res)) return;
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    const tail = readAuditTail(findAuditLog());
    sendJson(res, 200, {
      host: 'local',
      idempotent: true,
      mutating: false,
      contractVersion: CONTRACT_VERSION,
      checks: [
        { name: 'gateway-audit-log', ok: tail.source.present },
        { name: 'dsh-web-3081', ok: true, note: 'this web server answers' },
        { name: 'ladder-3131', ok: null, note: 'not probed by the panel' },
        { name: 'caddy-route', ok: null, note: 'vps-only: not checkable from local' },
        {
          name: 'tri-mcp-gateway',
          ok: null,
          note: 'not managed here; the audit log appears when the gateway runs',
        },
      ],
      anomalies: [
        !tail.source.present && 'audit log absent',
        tail.dropped > 0 && `${tail.dropped} audit line(s) failed the law and were dropped`,
      ].filter(Boolean),
    });
  };

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: AUDIT_PATH, handler: serveAudit }),
    `t27-gateway: GET ${AUDIT_PATH}`,
  );
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: HEALTH_PATH, handler: serveHealth }),
    `t27-gateway: GET ${HEALTH_PATH}`,
  );
}
