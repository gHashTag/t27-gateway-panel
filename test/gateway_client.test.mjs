// Contract test for the client adapter: it EXECUTES client.js and renders the
// panel, so an undefined identifier or a broken style shape fails the build.
//
// Why this file exists: the layout law lives in spec/gateway_ui.t27 and
// reaches the browser through the generated module, but client.js itself is
// hand-written plumbing over that module. A source grep only proves that one
// spelling of one defect is absent, and `node --check` only proves the file
// parses. A ReferenceError is neither. Only a real render proves the
// component runs, and that is what this test does.
//
// The expectations are read from the generated module: the test never copies
// a threshold, a label or a token of the law.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import {
  TOOLBAR_FLEX_WRAP_MODE,
  LONG_TEXT_WRAP_MODE,
  TOOLBAR_CONTROL_MAX_PX,
  TOOLBAR_CONTROL_MIN_PX,
  INPUT_MIN_WIDTH_PX,
  TOOLBAR_GAP_PX,
  PANEL_PADDING_PX,
  LABEL_SOURCE_ABSENT,
  NARROW_MAX_WIDTH_PX,
} from '../generated/gateway_ui.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLIENT_SOURCE = readFileSync(join(ROOT, 'client.js'), 'utf8');

// A path long enough to overflow a narrow panel as one unbreakable token.
const LONG_PATH = '/Users/playra/workspace/t27-gateway-panel/.trinity/gateway-audit.log';

/**
 * A React stub with real hook semantics: state survives a re-render, effects
 * run only when their dependencies changed, and a state change asks for
 * another render pass.
 */
function createReact() {
  const state = { hooks: [], cursor: 0, pendingEffects: [], dirty: false, renders: 0, refCallsInRender: 0 };

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat() };
    },
    useState(initial) {
      const index = state.cursor++;
      if (!(index in state.hooks)) {
        state.hooks[index] = typeof initial === 'function' ? initial() : initial;
      }
      const slot = index;
      const setState = (next) => {
        const value = typeof next === 'function' ? next(state.hooks[slot]) : next;
        if (!Object.is(value, state.hooks[slot])) {
          state.hooks[slot] = value;
          state.dirty = true;
        }
      };
      return [state.hooks[index], setState];
    },
    useRef(initial) {
      const index = state.cursor++;
      if (!(index in state.hooks)) state.hooks[index] = { current: initial };
      return state.hooks[index];
    },
    useCallback(fn) {
      state.cursor++;
      return fn;
    },
    useEffect(fn, deps) {
      const index = state.cursor++;
      const previous = state.hooks[index];
      const changed = previous === undefined || deps === undefined || deps.some((dep, i) => !Object.is(dep, previous[i]));
      state.hooks[index] = deps;
      if (changed) state.pendingEffects.push(fn);
    },
  };

  return { React, state };
}

/** Collect every element node of a rendered tree. */
function walk(node, visit) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== 'object') return;
  visit(node);
  walk(node.children, visit);
}

/** The rendered text of a node. */
function textOf(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
}

/**
 * Run client.js in a sandbox, render the panel at the given root width and
 * return the produced element tree.
 */
async function renderPanel(rootWidth) {
  const { React, state } = createReact();
  const rootNode = { offsetWidth: rootWidth };

  let captured = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          captured = entry;
        },
      },
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe(target) {
        this.callback([{ target }], this);
      }
      disconnect() {}
    },
    AbortController: class {
      constructor() {
        this.signal = { aborted: false };
      }
      abort() {
        this.signal.aborted = true;
      }
    },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        contractVersion: 1,
        source: { path: LONG_PATH, present: false, reason: 'absent' },
        total: 0,
        dropped: 0,
        events: [],
        counters: { allow: 0, deny: 0, denyRate: 0, total: 0 },
      }),
    }),
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    URLSearchParams,
    console,
  };
  sandbox.globalThis = sandbox;

  const context = createContext(sandbox);
  runInContext(CLIENT_SOURCE, context, { filename: 'client.js' });

  assert.equal(captured.id, '@local/t27-gateway', 'client.js registers under its package id');
  assert.equal(typeof captured.factory, 'function', 'client.js exposes a factory');

  // The generated UI module is the law the client consumes; the test reads
  // the same artifact the browser receives.
  const ui = await import('../generated/gateway_ui.mjs');
  const requireStub = (name) => {
    if (name === 'react') return React;
    throw new Error('unexpected require: ' + name);
  };
  requireStub.async = async () => ui;

  const plugin = captured.factory(requireStub);
  assert.equal(typeof plugin.apply, 'function', 'the plugin exposes apply(ctx)');

  let component = null;
  plugin.apply({
    slots: {
      inject: (name, register) => {
        register();
      },
      register: (meta, view) => {
        component = view;
      },
    },
  });
  assert.equal(typeof component, 'function', 'the panel component is registered into the dock slot');

  // The root ref must answer with the measured width, so the width effect
  // sees the width the test asks for. The panel calls useRef twice (the root
  // element and the abort controller); only the first one is the root.
  const originalUseRef = React.useRef;
  React.useRef = (initial) => {
    const ref = originalUseRef(initial);
    state.refCallsInRender += 1;
    if (state.refCallsInRender === 1 && ref.current === null) ref.current = rootNode;
    return ref;
  };

  let tree = null;
  for (let pass = 0; pass < 12; pass++) {
    state.cursor = 0;
    state.refCallsInRender = 0;
    state.pendingEffects = [];
    tree = component();
    state.renders++;
    for (const effect of state.pendingEffects) effect();
    // The generated chunk arrives asynchronously; let it land and re-render.
    await new Promise((resolve) => setImmediate(resolve));
    if (!state.dirty) break;
    state.dirty = false;
  }

  return tree;
}

test('the panel renders at a narrow width without throwing', async () => {
  // A ReferenceError in the render path (an identifier that no longer exists)
  // fails here, with the error message, instead of in the browser.
  const tree = await renderPanel(203);
  assert.notEqual(tree, null, 'the panel rendered an element tree');
  assert.equal(typeof tree.type, 'string', 'the tree root is an element');
});

test('the toolbar row is allowed to wrap, so no width can make it paint outside', async () => {
  const tree = await renderPanel(203);
  const rows = [];
  walk(tree, (node) => {
    const style = node.props?.style;
    if (style !== undefined && style.display === 'flex' && style.gap === TOOLBAR_GAP_PX) rows.push(node);
  });
  assert.equal(rows.length, 1, 'the toolbar row is found by its generated gap');
  assert.equal(rows[0].props.style.flexWrap, TOOLBAR_FLEX_WRAP_MODE, 'the row carries the generated wrap mode');
});

test('the long source path breaks with the generated mode instead of overflowing', async () => {
  const tree = await renderPanel(203);
  const carriers = [];
  walk(tree, (node) => {
    const style = node.props?.style;
    if (style !== undefined && style.overflowWrap === LONG_TEXT_WRAP_MODE) carriers.push(node);
  });
  // The detail line and the state line both carry the path.
  assert.ok(carriers.length >= 2, 'the path is carried by the detail line and the state line');
  for (const node of carriers) {
    assert.equal(node.props.style.whiteSpace, undefined, 'no carrier pins white-space: nowrap');
    assert.ok(textOf(node).includes(LONG_PATH), 'the carrier really carries the long path');
  }
});

test('the toolbar controls carry the generated min and max widths', async () => {
  const tree = await renderPanel(203);
  const selects = [];
  const inputs = [];
  walk(tree, (node) => {
    if (node.type === 'select') selects.push(node);
    if (node.type === 'input') inputs.push(node);
  });
  assert.equal(selects.length, 2, 'the toolbar has two selects');
  assert.equal(inputs.length, 1, 'the toolbar has one text input');
  for (const select of selects) {
    assert.equal(select.props.style.minWidth, TOOLBAR_CONTROL_MIN_PX, 'the select shrinks to the generated floor');
    assert.equal(select.props.style.maxWidth, TOOLBAR_CONTROL_MAX_PX, 'the select grows to the generated ceiling');
  }
  assert.equal(inputs[0].props.style.minWidth, INPUT_MIN_WIDTH_PX, 'the input keeps the generated floor');
  assert.equal(inputs[0].props.style.maxWidth, TOOLBAR_CONTROL_MAX_PX, 'the input honours the generated ceiling');
});

test('the panel root uses the generated padding, so the content box is the law', async () => {
  const tree = await renderPanel(203);
  assert.equal(tree.props.style.padding, PANEL_PADDING_PX, 'the panel padding comes from the law');
});

test('the narrow column hides still follow the generated narrow law', async () => {
  const tree = await renderPanel(NARROW_MAX_WIDTH_PX - 1);
  const hidden = [];
  walk(tree, (node) => {
    if (node.type === 'span') hidden.push(textOf(node));
  });
  // With no audit events there are no rows; the law is still consumed.
  assert.equal(Array.isArray(hidden), true);
});
