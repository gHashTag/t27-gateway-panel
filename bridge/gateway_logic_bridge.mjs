
// ===========================================================================
// PLATFORM BRIDGE -- composition section (no rule of its own)
// ===========================================================================
// `t27c gen-js` 0.5.2 emits data, never code: every `fn` of the spec is
// refused with "ExprIndex is not a constant expression. This backend emits
// data, never code." (see __NOT_EMITTED__ above). The law therefore lives in
// spec/gateway_logic.t27 -- proven there by its own test blocks
// (`t27c test-report spec/gateway_logic.t27`, 13/13, 0 vacuous) -- and this
// section only COMPOSES the required runtime API out of the generated data
// above. Every threshold, table and reason string used below is an emitted
// const; nothing here introduces a rule. Documented platform-bridge
// exception per the migration charter: a hidden workaround would be a rule
// outside the spec; this is a marked exception with the law kept in the spec.
//
// Exact refit procedure once the backend lowers indexed bodies:
//   t27c gen-js spec/gateway_logic.t27 > generated/gateway_logic.mjs
//   (this section is then replaced by the emitted fns; the exported API below
//    is its contract)
//
// Filter semantics, exact (mirrors event_matches_filter in the spec): a part
// is ACTIVE when it is neither null nor undefined; active parts AND together;
// `tool` compares exactly, `decision` compares exactly, `text` is an
// ASCII-only case-insensitive substring of actor OR tool (only A-Z lowers).
// ===========================================================================

const __TOOL_SET = new Set(TOOL_NAMES);
const __PRODUCER_SET = new Set(AUDIT_TOOLS);

function __asciiLower(s) {
    return s.replace(/[A-Z]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) + 32);
    });
}

function __reject(code) {
    return { ok: false, reason: REASON_TEXTS[code] };
}

function __digits(v, minLen, maxLen) {
    return typeof v === "string" &&
        v.length >= minLen && v.length <= maxLen &&
        /^[0-9]+$/.test(v);
}

function __fieldSplit(line) {
    return String(line).split("\t");
}

export function parseAuditLine(line) {
    if (typeof line !== "string") { return __reject(REJ_FIELD_COUNT); }
    const f = __fieldSplit(line);
    if (f.length !== FIELD_COUNT) { return __reject(REJ_FIELD_COUNT); }
    // ts: 1..10 ASCII digits, numeric integer (u32 epoch seconds, spec law)
    if (!__digits(f[TS_FIELD], 1, 10)) { return __reject(REJ_TS); }
    const ts = Number(f[TS_FIELD]);
    if (!Number.isSafeInteger(ts)) { return __reject(REJ_TS); }
    // tool: first a policy row, then an audit producer (two distinct laws)
    const tool = f[TOOL_FIELD];
    if (!__TOOL_SET.has(tool)) { return __reject(REJ_UNKNOWN_TOOL); }
    if (!__PRODUCER_SET.has(tool)) { return __reject(REJ_NOT_PRODUCER); }
    const actor = f[ACTOR_FIELD];
    const scope = f[SCOPE_FIELD];
    // decision: exactly one digit, value <= DECISION_DENY_RATE
    const dRaw = f[DECISION_FIELD];
    if (dRaw.length !== 1 || !/^[0-9]$/.test(dRaw)) { return __reject(REJ_DECISION); }
    const decision = Number(dRaw);
    if (decision > DECISION_DENY_RATE) { return __reject(REJ_DECISION); }
    // reason: 1..3 ASCII digits, value <= 255 (fail closed, never a fake 255)
    const rRaw = f[REASON_FIELD];
    if (!__digits(rRaw, 1, 3)) { return __reject(REJ_INCONSISTENT); }
    const reason = Number(rRaw);
    if (reason > 255) { return __reject(REJ_INCONSISTENT); }
    // consistency, both directions: decision 0 <=> reason 0; 1|2 => reason >= 10
    const consistent = decision === DECISION_ALLOW
        ? reason === REASON_NONE
        : reason >= REASON_MIN_DENY && decision <= DECISION_DENY_RATE;
    if (!consistent) { return __reject(REJ_INCONSISTENT); }
    // request hash: 1..20 digits, KEPT as a decimal string (u64 in the spec)
    const requestHash = f[HASH_FIELD];
    if (!__digits(requestHash, 1, 20)) { return __reject(REJ_HASH); }
    return {
        ok: true,
        event: { ts, actor, tool, scope, decision, reason, requestHash },
    };
}

export function filterEvents(events, filter) {
    const hasTool = filter != null && filter.tool != null;
    const hasDecision = filter != null && filter.decision != null;
    const hasText = filter != null && filter.text != null;
    const tool = hasTool ? filter.tool : null;
    const decision = hasDecision ? filter.decision : null;
    const needle = hasText ? __asciiLower(String(filter.text)) : "";
    return (events || []).filter(function (ev) {
        if (hasTool && ev.tool !== tool) { return false; }
        if (hasDecision && ev.decision !== decision) { return false; }
        if (hasText) {
            const inActor = __asciiLower(ev.actor).indexOf(needle) !== -1;
            const inTool = __asciiLower(ev.tool).indexOf(needle) !== -1;
            if (!(inActor || inTool)) { return false; }
        }
        return true;
    });
}

export function countByDecision(events) {
    var allow = 0, deny = 0, denyRate = 0, total = 0;
    for (const ev of (events || [])) {
        total += 1;
        if (ev.decision === DECISION_ALLOW) { allow += 1; }
        else if (ev.decision === DECISION_DENY) { deny += 1; }
        else if (ev.decision === DECISION_DENY_RATE) { denyRate += 1; }
    }
    return { allow, deny, denyRate, total };
}

export function applyTail(events, tailLines) {
    const list = events || [];
    const n = Math.max(0, Number(tailLines) || 0);
    return list.slice(Math.max(0, list.length - n));
}
