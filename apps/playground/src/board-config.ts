/**
 * Board configuration panel and adapter switcher (BOARD-2402).
 *
 * Supports switching between Vanilla (@kujam/renderer), React (@kujam/react),
 * and Vue (@kujam/vue) adapters while preserving the document and board state.
 */

import { type Board, type BoardLocale } from '@kujam/core';
import { Board as ReactBoard } from '@kujam/react';
import { mountRenderer, type BoardBackground, type BoardView } from '@kujam/renderer';
import { attachTextEditor } from '@kujam/shapes';
import { mountDefaultUi, type MountedUi } from '@kujam/ui';
import { Board as VueBoard } from '@kujam/vue';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createApp, h as vueH, type App as VueApp } from 'vue';

import { h, section } from './dom.js';
import type { ScenarioState } from './scenario.js';

export type BoardAdapterType = 'vanilla' | 'react' | 'vue';

export interface BoardHarnessOptions {
  readonly board: Board;
  readonly stage: HTMLElement;
  readonly state?: ScenarioState;
  readonly initialAdapter?: BoardAdapterType;
  readonly initialBackground?: BoardBackground;
  readonly enableUi?: boolean;
  readonly onAdapterChange?: (adapter: BoardAdapterType) => void;
}

export class BoardHarness {
  readonly board: Board;
  readonly stage: HTMLElement;
  readonly state?: ScenarioState;

  private activeAdapter: BoardAdapterType;
  private background: BoardBackground;
  private uiEnabled: boolean;
  private mountedUi: MountedUi | null = null;
  private mountedView: BoardView | null = null;
  private activeTextEditor: { detach(): void } | null = null;

  // React root reference
  private reactRoot: Root | null = null;
  // Vue app reference
  private vueApp: VueApp | null = null;

  private onAdapterChangeCallbacks: ((adapter: BoardAdapterType) => void)[] = [];

  constructor(options: BoardHarnessOptions) {
    this.board = options.board;
    this.stage = options.stage;
    this.state = options.state;

    const savedAdapter = this.state?.get('adapter') as BoardAdapterType | null;
    this.activeAdapter =
      savedAdapter && ['vanilla', 'react', 'vue'].includes(savedAdapter)
        ? savedAdapter
        : (options.initialAdapter ?? 'vanilla');

    this.background = options.initialBackground ?? 'dots';
    this.uiEnabled = options.enableUi ?? true;

    if (options.onAdapterChange) {
      this.onAdapterChangeCallbacks.push(options.onAdapterChange);
    }
  }

  get adapter(): BoardAdapterType {
    return this.activeAdapter;
  }

  get currentView(): BoardView | null {
    return this.mountedView;
  }

  onAdapterChange(cb: (adapter: BoardAdapterType) => void): () => void {
    this.onAdapterChangeCallbacks.push(cb);
    return () => {
      this.onAdapterChangeCallbacks = this.onAdapterChangeCallbacks.filter((c) => c !== cb);
    };
  }

  mount(): void {
    this.mountCurrentAdapter();
  }

  setAdapter(next: BoardAdapterType): void {
    if (this.activeAdapter === next && (this.mountedView || this.reactRoot || this.vueApp)) {
      return;
    }
    this.unmountCurrentAdapter();
    this.activeAdapter = next;
    this.state?.set('adapter', next === 'vanilla' ? null : next);
    this.mountCurrentAdapter();
    for (const cb of this.onAdapterChangeCallbacks) {
      cb(next);
    }
  }

  setBackground(bg: BoardBackground): void {
    this.background = bg;
    if (this.mountedView) {
      this.mountedView.background = bg;
    }
  }

  getBackground(): BoardBackground {
    return this.background;
  }

  setUiEnabled(enabled: boolean): void {
    this.uiEnabled = enabled;
    if (enabled) {
      if (!this.mountedUi) {
        this.mountedUi = mountDefaultUi({ board: this.board, container: this.stage });
      }
    } else if (this.mountedUi) {
      this.mountedUi.unmount();
      this.mountedUi = null;
    }
  }

  isUiEnabled(): boolean {
    return this.uiEnabled;
  }

  private unmountCurrentAdapter(): void {
    if (this.activeTextEditor) {
      this.activeTextEditor.detach();
      this.activeTextEditor = null;
    }
    if (this.mountedUi) {
      this.mountedUi.unmount();
      this.mountedUi = null;
    }
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
    if (this.vueApp) {
      this.vueApp.unmount();
      this.vueApp = null;
    }
    if (this.mountedView) {
      this.mountedView.unmount();
      this.mountedView = null;
    }
    this.stage.replaceChildren();
  }

  private mountCurrentAdapter(): void {
    this.unmountCurrentAdapter();

    const onCommonViewMount = (view: BoardView) => {
      this.mountedView = view;
      this.activeTextEditor = attachTextEditor(view);
      if (this.uiEnabled && !this.mountedUi) {
        this.mountedUi = mountDefaultUi({ board: this.board, container: this.stage });
      }
    };

    switch (this.activeAdapter) {
      case 'vanilla': {
        const view = mountRenderer(this.board, this.stage, {
          background: this.background,
        });
        onCommonViewMount(view);
        break;
      }
      case 'react': {
        const root = createRoot(this.stage);
        this.reactRoot = root;
        root.render(
          React.createElement(ReactBoard, {
            board: this.board,
            background: this.background,
            onMount: (view: BoardView) => {
              onCommonViewMount(view);
              return () => {
                this.activeTextEditor?.detach();
                this.activeTextEditor = null;
                this.mountedView = null;
              };
            },
          }),
        );
        break;
      }
      case 'vue': {
        const app = createApp({
          render: () =>
            vueH(VueBoard, {
              board: this.board,
              background: this.background,
              onMount: (view: BoardView) => {
                onCommonViewMount(view);
              },
              onUnmount: () => {
                this.activeTextEditor?.detach();
                this.activeTextEditor = null;
                this.mountedView = null;
              },
            }),
        });
        this.vueApp = app;
        app.mount(this.stage);
        break;
      }
    }
  }

  destroy(): void {
    this.unmountCurrentAdapter();
    this.onAdapterChangeCallbacks = [];
  }
}

/**
 * Creates the configuration controls panel section for a board harness.
 */
export function createBoardConfigPanel(harness: BoardHarness): HTMLElement {
  const board = harness.board;

  // ---------- 1. Adapter Switcher ----------
  const adapterSelect = h(
    'select',
    {
      style: 'width: 100%; font-weight: 500;',
      onchange: () => {
        harness.setAdapter(adapterSelect.value as BoardAdapterType);
      },
    },
    h('option', { value: 'vanilla' }, 'Vanilla (@kujam/renderer)'),
    h('option', { value: 'react' }, 'React (@kujam/react <Board />)'),
    h('option', { value: 'vue' }, 'Vue (@kujam/vue <Board />)'),
  );
  adapterSelect.value = harness.adapter;

  const adapterNotice = h(
    'div',
    { class: 'muted', style: 'font-size: 11px; margin-top: 4px;' },
    'Beralih adapter tetap mempertahankan dokumen & riwayat papan.',
  );

  harness.onAdapterChange((newAdapter) => {
    adapterSelect.value = newAdapter;
  });

  // ---------- 2. Tema & Bahasa ----------
  const themeBtn = h(
    'button',
    {
      type: 'button',
      onclick: () => {
        const next = board.theme.mode === 'light' ? 'dark' : 'light';
        board.setTheme(next);
        updateThemeLabel();
      },
    },
    board.theme.mode === 'dark' ? '🌙 Tema: Gelap' : '☀️ Tema: Terang',
  );

  function updateThemeLabel(): void {
    themeBtn.textContent = board.theme.mode === 'dark' ? '🌙 Tema: Gelap' : '☀️ Tema: Terang';
  }

  board.on('theme', updateThemeLabel);

  const localeBtn = h(
    'button',
    {
      type: 'button',
      onclick: () => {
        const next: BoardLocale = board.locale === 'id' ? 'en' : 'id';
        board.setLocale(next);
        updateLocaleLabel();
      },
    },
    board.locale === 'en' ? '🌐 Bahasa: EN' : '🌐 Bahasa: ID',
  );

  function updateLocaleLabel(): void {
    localeBtn.textContent = board.locale === 'en' ? '🌐 Bahasa: EN' : '🌐 Bahasa: ID';
  }

  // ---------- 3. Mode Akses (readOnly) ----------
  const readOnlyCheckbox = h('input', {
    type: 'checkbox',
    id: 'config-readonly',
    checked: board.readOnly,
    onchange: () => {
      board.setReadOnly(readOnlyCheckbox.checked);
      readOnlyStatus.textContent = board.readOnly ? '🔒 Mode Baca Saja Aktif' : '✏️ Mode Interaktif Aktif';
      readOnlyStatus.style.color = board.readOnly ? 'var(--warn)' : 'var(--ok)';
    },
  });

  const readOnlyLabel = h(
    'label',
    { for: 'config-readonly', style: 'cursor: pointer; display: flex; align-items: center; gap: 6px;' },
    readOnlyCheckbox,
    'Kunci Papan (readOnly)',
  );

  const readOnlyStatus = h(
    'span',
    {
      class: 'muted',
      style: `font-size: 11px; color: ${board.readOnly ? 'var(--warn)' : 'var(--ok)'};`,
    },
    board.readOnly ? '🔒 Mode Baca Saja Aktif' : '✏️ Mode Interaktif Aktif',
  );

  // ---------- 4. Snapping & Grid ----------
  const snapGridCheckbox = h('input', {
    type: 'checkbox',
    id: 'config-snap-grid',
    checked: board.snapOptions.grid !== null,
    onchange: () => {
      const isChecked = snapGridCheckbox.checked;
      const size = Number(gridSizeInput.value) || 8;
      board.setSnapOptions({ grid: isChecked ? size : null });
    },
  });

  const snapElementsCheckbox = h('input', {
    type: 'checkbox',
    id: 'config-snap-elements',
    checked: board.snapOptions.elements !== false,
    onchange: () => {
      board.setSnapOptions({ elements: snapElementsCheckbox.checked });
    },
  });

  const gridSizeInput = h('select', {
    style: 'padding: 2px 6px; font-size: 12px;',
    onchange: () => {
      const size = Number(gridSizeInput.value) || 8;
      if (snapGridCheckbox.checked) {
        board.setSnapOptions({ grid: size });
      }
    },
  },
    h('option', { value: '4' }, '4px'),
    h('option', { value: '8' }, '8px (standar)'),
    h('option', { value: '12' }, '12px'),
    h('option', { value: '16' }, '16px'),
    h('option', { value: '24' }, '24px'),
    h('option', { value: '32' }, '32px'),
  );
  gridSizeInput.value = String(board.snapOptions.grid ?? 8);

  const snapContainer = h(
    'div',
    { class: 'column', style: 'display: flex; flex-direction: column; gap: 8px;' },
    h(
      'label',
      { style: 'display: flex; align-items: center; gap: 6px; cursor: pointer;' },
      snapGridCheckbox,
      'Snap ke Grid',
    ),
    h(
      'label',
      { style: 'display: flex; align-items: center; gap: 6px; cursor: pointer;' },
      snapElementsCheckbox,
      'Snap ke Elemen Lain',
    ),
    h(
      'div',
      { class: 'row', style: 'align-items: center; justify-content: space-between;' },
      h('span', { class: 'muted', style: 'font-size: 12px;' }, 'Jarak Grid:'),
      gridSizeInput,
    ),
  );

  // ---------- 5. Batas Zoom ----------
  const currentZoomRange = board.camera.zoomRange;
  const minZoomInput = h('input', {
    type: 'number',
    step: '0.1',
    min: '0.05',
    max: '1',
    value: String(currentZoomRange.min),
    style: 'width: 60px; padding: 2px 4px; font-size: 12px;',
    onchange: () => updateZoomLimits(),
  });

  const maxZoomInput = h('input', {
    type: 'number',
    step: '0.5',
    min: '1',
    max: '20',
    value: String(currentZoomRange.max),
    style: 'width: 60px; padding: 2px 4px; font-size: 12px;',
    onchange: () => updateZoomLimits(),
  });

  const zoomLimitNotice = h('div', { class: 'muted', style: 'font-size: 11px;' }, 'Rentang zoom saat ini: 10% - 400%');

  function updateZoomLimits(): void {
    const minVal = parseFloat(minZoomInput.value);
    const maxVal = parseFloat(maxZoomInput.value);
    if (minVal > 0 && maxVal >= minVal && Number.isFinite(minVal) && Number.isFinite(maxVal)) {
      board.camera.setZoomRange({ min: minVal, max: maxVal });
      zoomLimitNotice.textContent = `Rentang zoom: ${Math.round(minVal * 100)}% - ${Math.round(maxVal * 100)}%`;
      zoomLimitNotice.style.color = '';
    } else {
      zoomLimitNotice.textContent = 'Batas zoom tidak valid (min harus > 0 dan <= max).';
      zoomLimitNotice.style.color = 'var(--error)';
    }
  }

  const zoomRow = h(
    'div',
    { class: 'row', style: 'justify-content: space-between; align-items: center;' },
    h('span', { style: 'font-size: 12px;' }, 'Min:'),
    minZoomInput,
    h('span', { style: 'font-size: 12px; margin-left: 8px;' }, 'Max:'),
    maxZoomInput,
  );

  return h(
    'div',
    { class: 'board-config-panel' },
    section('Adapter Papan', adapterSelect, adapterNotice),
    section('Tema & Bahasa', h('div', { class: 'row wrap' }, themeBtn, localeBtn)),
    section('Mode Akses', h('div', { class: 'column', style: 'display: flex; flex-direction: column; gap: 4px;' }, readOnlyLabel, readOnlyStatus)),
    section('Snapping & Grid', snapContainer),
    section('Batas Zoom Kamera', zoomRow, zoomLimitNotice),
  );
}
