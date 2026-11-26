// Client adapter for the gateway audit panel.
//
// UI LAW LIVES IN THE SPEC: spec/gateway_ui.t27 compiles to
// generated/gateway_ui.mjs, which the browser receives through the
// package-local chunk client.gateway_ui.js (a classic script beside this file
// that self-registers "@local/t27-gateway/client.gateway_ui.js" via
// __ModuleLoader__.load). This file holds no state mapping, no row cap, no
// badge decision, no colors: it polls the host API and renders exactly the
// view model the generated module returns.
window.__ModuleLoader__.load({
  id: '@local/t27-gateway',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Package-local chunk bridge: the generated spec module arrives as a
    // sibling chunk (client.gateway_ui.js) and is loaded asynchronously here.
    const uiPromise = require.async('./client.gateway_ui.js');

    const POLL_MS = 10000;
    const TEXT_DEBOUNCE_MS = 400;
    const AUDIT_URL = '/api/t27-gateway/audit';

    const ellipsisStyle = {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    };

    function GatewayPanel() {
      const [ui, setUi] = React.useState(null);
      const [phase, setPhase] = React.useState('loading');
      const [payload, setPayload] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [filter, setFilter] = React.useState({ tool: null, decision: null, text: '' });
      const [appliedText, setAppliedText] = React.useState('');
      const [widthPx, setWidthPx] = React.useState(0);
      const rootRef = React.useRef(null);
      const abortRef = React.useRef(null);

      // The generated module arrives as a classic-script chunk.
      React.useEffect(() => {
        let alive = true;
        uiPromise.then(
          (module) => { if (alive) setUi(module); },
          (loadError) => { if (alive) setError(loadError); },
        );
        return () => { alive = false; };
      }, [uiPromise]);

      // Filtering is the generated host-side law: the client sends the raw
      // filter as query parameters and never applies a rule of its own.
      const fetchAudit = React.useCallback(() => {
        if (abortRef.current !== null) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const query = new URLSearchParams();
        if (filter.tool !== null) query.set('tool', filter.tool);
        if (filter.decision !== null) query.set('decision', filter.decision);
        if (appliedText !== '') query.set('text', appliedText);
        const queryString = query.toString();
        const url = AUDIT_URL + (queryString === '' ? '' : '?' + queryString);
        fetch(url, { signal: controller.signal })
          .then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then((body) => {
            if (controller.signal.aborted) return;
            setPayload(body);
            setError(null);
            setPhase('ready');
          })
          .catch((fetchError) => {
            if (controller.signal.aborted) return;
            setError(fetchError);
            setPhase('ready');
          });
      }, [filter.tool, filter.decision, appliedText]);

      React.useEffect(() => {
        fetchAudit();
        const timer = setInterval(fetchAudit, POLL_MS);
        return () => {
          clearInterval(timer);
          if (abortRef.current !== null) abortRef.current.abort();
        };
      }, [fetchAudit]);

      React.useEffect(() => {
        const node = rootRef.current;
        if (node === null) return undefined;
        setWidthPx(node.offsetWidth);
        if (typeof ResizeObserver !== 'function') return undefined;
        const observer = new ResizeObserver((entries) => {
          const first = entries[0];
          if (first !== undefined) setWidthPx(first.target.offsetWidth);
        });
        observer.observe(node);
        return () => observer.disconnect();
      }, [ui]);

      React.useEffect(() => {
        const timer = setTimeout(() => setAppliedText(filter.text), TEXT_DEBOUNCE_MS);
        return () => clearTimeout(timer);
      }, [filter.text]);

      // Until the generated module is here there is no UI law to render, so
      // the panel renders nothing at all rather than a hand-written shape.
      if (ui === null) return null;

      const body = payload;
      const events =
        body !== null && body !== undefined && Array.isArray(body.events) ? body.events : [];
      // Counters arrive counted by the host half over the same filtered set
      // the panel renders; this adapter never counts by itself.
      const counters =
        body !== null && body !== undefined && body.counters !== undefined
          ? body.counters
          : { allow: 0, deny: 0, denyRate: 0, total: 0 };
      const dropped = body !== null && body !== undefined && body.dropped !== undefined ? body.dropped : 0;
      const sourcePath =
        body !== null && body !== undefined && body.source !== undefined && body.source.path !== undefined
          ? body.source.path
          : '';
      const status = error !== null ? 500 : 200;

      // PLATFORM BRIDGE -- composition, no rule of its own. gen-js lowers
      // scalars only, so assembling header/rows/footer from the generated
      // scalars happens here; every state mapping, threshold, label, token
      // and option list below is read from the generated module, none is
      // invented here.
      const kind = ui.resolve_state_kind(
        error === null && body !== null && body !== undefined,
        body !== null && body !== undefined && body.source !== undefined && body.source.present === true,
        events.length,
      );
      const detail = ui.state_detail(kind, status, sourcePath);
      const title = ui.LABEL_TITLE;
      const countersLine = ui.LABEL_COUNTERS_TEMPLATE
        .replace('{allow}', String(counters.allow))
        .replace('{deny}', String(counters.deny))
        .replace('{denyRate}', String(counters.denyRate))
        .replace('{total}', String(counters.total));
      const footerText = ui.LABEL_DROPPED_TEMPLATE.replace('{dropped}', String(dropped));
      const narrow = ui.is_narrow(widthPx);
      const stateText =
        kind === 1 ? ui.LABEL_ERROR : kind === 2 ? ui.LABEL_SOURCE_ABSENT : kind === 3 ? ui.LABEL_EMPTY : null;

      const rows = events.slice(0, ui.visible_row_count(events.length)).map((row, index) => ({
        key: index,
        cells: [
          { text: String(row.ts), secondary: true, hideWhenNarrow: false },
          { text: String(row.actor), secondary: false, hideWhenNarrow: false },
          { text: String(row.tool), secondary: true, hideWhenNarrow: false },
          { text: String(row.scope), secondary: true, hideWhenNarrow: true },
          { text: String(row.requestHash), secondary: true, hideWhenNarrow: true },
        ],
        badge: { label: ui.badge_label(row.decision), colorToken: ui.badge_color_token(row.decision) },
      }));

      const onToolChange = (event) => {
        const value = event.target.value;
        setFilter((prev) => ({ ...prev, tool: value === ui.LABEL_TOOL_ALL ? null : value }));
      };
      const onDecisionChange = (event) => {
        const value = event.target.value;
        setFilter((prev) => ({ ...prev, decision: value === ui.LABEL_DECISION_ALL ? null : value }));
      };
      const onTextChange = (event) => {
        const value = event.target.value;
        setFilter((prev) => ({ ...prev, text: value }));
      };
      const onRetry = () => { fetchAudit(); };

      const panelStyle = {
        background: 'var(' + ui.STYLE_TOKEN_BG + ', inherit)',
        border: '1px solid var(' + ui.STYLE_TOKEN_BORDER + ', transparent)',
        borderRadius: 8,
        padding: 12,
        margin: '8px 0',
        minWidth: 0,
        color: 'inherit',
      };
      const secondaryStyle = { color: 'var(' + ui.STYLE_TOKEN_TEXT_SECONDARY + ', inherit)' };
      const selectStyle = { ...ellipsisStyle, maxWidth: 160 };
      const inputStyle = { flex: '1 1 120px', minWidth: 80 };

      const rowNodes = rows.map((row) =>
        h(
          'div',
          { key: row.key, style: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0' } },
          row.cells
            .filter((cell) => !(narrow === true && cell.hideWhenNarrow === true))
            .map((cell, index) =>
              h(
                'span',
                {
                  key: index,
                  style: {
                    ...ellipsisStyle,
                    minWidth: 0,
                    ...(cell.secondary === true ? secondaryStyle : null),
                  },
                },
                cell.text,
              ),
            ),
          h(
            'span',
            {
              style: {
                marginLeft: 'auto',
                color: 'var(' + row.badge.colorToken + ', inherit)',
                whiteSpace: 'nowrap',
              },
            },
            row.badge.label,
          ),
        ),
      );

      return h(
        'div',
        { ref: rootRef, style: panelStyle },
        h('div', null, title),
        detail !== '' ? h('div', { style: secondaryStyle }, detail) : null,
        h('div', { style: secondaryStyle }, countersLine),
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' } },
          h(
            'select',
            { style: selectStyle, value: filter.tool !== null ? filter.tool : ui.LABEL_TOOL_ALL, onChange: onToolChange },
            ui.TOOL_OPTIONS.map((option) =>
              h('option', { key: option, value: option }, option),
            ),
          ),
          h(
            'select',
            { style: selectStyle, value: filter.decision !== null ? filter.decision : ui.LABEL_DECISION_ALL, onChange: onDecisionChange },
            ui.DECISION_OPTIONS.map((option) =>
              h('option', { key: option, value: option }, option),
            ),
          ),
          h('input', {
            style: inputStyle,
            type: 'text',
            value: filter.text,
            onChange: onTextChange,
          }),
          h('button', { type: 'button', onClick: onRetry }, ui.LABEL_RETRY),
        ),
        stateText !== null
          ? h(
              'div',
              { style: secondaryStyle },
              stateText + (detail !== '' ? ' -- ' + detail : ''),
            )
          : rowNodes,
        h('div', { style: secondaryStyle }, footerText),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 't27-gateway-dashboard', order: 6 },
            GatewayPanel,
          ),
        );
      },
    };
  },
});
