/**
 * Development playground for @kujam/* (BOARD-2401).
 *
 * Route: `/s/<scenario>`. Global query: `bare=1` (center area only, for Playwright),
 * `debug=0` (hide the debug panel), `test=1` (test mode: the scenario's board is exposed as
 * `window.__board`, BOARD-2415). Other query params belong to the active scenario.
 */
import type { Board } from '@kujam/core';
import { append, h } from './dom.js';
import { buildLanPopover } from './lan.js';
import { DEFAULT_SCENARIO, findScenario, scenarios } from './registry.js';
import type { ScenarioState } from './scenario.js';
import './inspector.css';

const GLOBAL_KEYS = ['bare', 'debug', 'test'];

declare global {
  interface Window {
    /** Board of the active scenario, only in test mode (BOARD-2415). */
    __board?: Board;
  }
}

const testMode = new URL(location.href).searchParams.get('test') === '1';

/** Exposes `board` in test mode; {@link clearExposedBoard} removes it on scenario changes. */
function exposeBoard(board: Board): void {
  if (!testMode) return;
  window.__board = board;
}

function clearExposedBoard(): void {
  delete window.__board;
  delete document.documentElement.dataset.boardReady;
}

function currentScenarioId(): string {
  const match = /^\/s\/([^/]+)\/?$/.exec(location.pathname);
  return match ? decodeURIComponent(match[1]!) : DEFAULT_SCENARIO;
}

function setQuery(key: string, value: string | null): void {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  history.replaceState(null, '', url);
}

const state: ScenarioState = {
  get: (key) => new URL(location.href).searchParams.get(key),
  set: setQuery,
};

// ---------- Layout ----------

const app = document.getElementById('app')!;
const params = new URL(location.href).searchParams;
const shell = h('div', {
  class: 'playground-shell',
  dataset: { bare: String(params.get('bare') === '1') },
});

const picker = h('select', { 'aria-label': 'Skenario', onchange: () => navigate(picker.value) });
for (const s of scenarios)
  picker.append(h('option', { value: s.id, title: s.description }, s.title));

const debugToggle = h('button', {
  type: 'button',
  class: 'ghost',
  onclick: () => {
    const hidden = shell.dataset.debug !== 'false';
    shell.dataset.debug = String(!hidden);
    setQuery('debug', hidden ? '0' : null);
    debugToggle.textContent = hidden ? 'Tampilkan debug' : 'Sembunyikan debug';
  },
});

let popover: HTMLElement | null = null;
const lanButton = h(
  'button',
  {
    type: 'button',
    class: 'ghost',
    'aria-expanded': 'false',
    onclick: async () => {
      if (popover) {
        popover.remove();
        popover = null;
        lanButton.setAttribute('aria-expanded', 'false');
        return;
      }
      popover = await buildLanPopover();
      lanButton.after(popover);
      lanButton.setAttribute('aria-expanded', 'true');
    },
  },
  'Perangkat lain (QR)',
);

const description = h('span', { class: 'muted' });
const topbar = h(
  'header',
  { class: 'topbar' },
  h('div', { class: 'row' }, h('strong', {}, '@kujam/* Playground'), picker, description),
  h('div', { class: 'row popover-anchor' }, lanButton, debugToggle),
);
const controls = h('aside', { class: 'panel-left', 'aria-label': 'Kontrol skenario' });
const main = h('main', { class: 'stage' });
const debug = h('aside', { class: 'panel-right', 'aria-label': 'Panel debug' });
shell.append(topbar, controls, main, debug);
app.replaceChildren(shell);

const debugVisible = params.get('debug') !== '0';
shell.dataset.debug = String(debugVisible);
debugToggle.textContent = debugVisible ? 'Sembunyikan debug' : 'Tampilkan debug';

// ---------- Routing ----------

let cleanup: (() => void) | void;

function render(): void {
  cleanup?.();
  cleanup = undefined;
  clearExposedBoard();
  popover?.remove();
  popover = null;
  controls.replaceChildren();
  main.replaceChildren();
  debug.replaceChildren();

  const id = currentScenarioId();
  const scenario = findScenario(id);
  if (!scenario) {
    main.dataset.layout = 'lab';
    description.textContent = '';
    append(
      main,
      h(
        'div',
        { class: 'lab' },
        h('h2', {}, 'Skenario tidak ditemukan: ', h('code', {}, id)),
        h('p', {}, 'Pilih skenario di bilah atas.'),
      ),
    );
    return;
  }
  picker.value = scenario.id;
  description.textContent = scenario.description;
  document.title = `${scenario.title} · @kujam Playground`;
  main.dataset.layout = scenario.layout;
  cleanup = scenario.mount({ main, controls, debug, state, expose: exposeBoard });
  // Helpers wait for this attribute: the scenario has mounted and seeded its board.
  if (window.__board) document.documentElement.dataset.boardReady = 'true';
}

function navigate(id: string): void {
  const url = new URL(`/s/${encodeURIComponent(id)}`, location.origin);
  const current = new URL(location.href).searchParams;
  for (const key of GLOBAL_KEYS) if (current.has(key)) url.searchParams.set(key, current.get(key)!);
  history.pushState(null, '', url);
  render();
}

window.addEventListener('popstate', render);
if (!location.pathname.startsWith('/s/'))
  history.replaceState(null, '', `/s/${DEFAULT_SCENARIO}${location.search}`);
render();
