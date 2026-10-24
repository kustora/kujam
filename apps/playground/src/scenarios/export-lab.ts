/**
 * Export lab (BOARD-2413): the board on the left and a live preview of its PNG, SVG, PDF, plain
 * text, or JSON export on the right, for the whole board, the selection, or one frame. Scale,
 * background, and padding are adjustable, and the result can be downloaded.
 *
 * Query (kept while switching options): `format=png|svg|pdf|text|json`, `scope=board|selection|frame`,
 * `frame=<id>`, `scale=1..4`, `bg=theme|transparent|#rrggbb`, `padding=<board units>`.
 */

import { createBoard, defaultCommands, type Board, type BoardDocument } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { attachTextEditor, defaultElements, defaultTools } from '@kujam/shapes';
import {
  formatBytes,
  LAB_FORMATS,
  LAB_SCALES,
  LabScopeError,
  listFrames,
  readLabOptions,
  runLabExport,
  writeLabOptions,
  type LabFormat,
  type LabOptions,
  type LabResult,
  type LabScope,
} from '../export-lab.js';
import { h, section } from '../dom.js';
import { defineScenario } from '../scenario.js';

const kitchenSink = Object.values(
  import.meta.glob<BoardDocument>('../../../../fixtures/documents/0.1.0/kitchen-sink.json', {
    eager: true,
    import: 'default',
  }),
)[0]!;

const FORMAT_LABEL: Record<LabFormat, string> = {
  png: 'PNG',
  svg: 'SVG',
  pdf: 'PDF',
  text: 'Teks',
  json: 'JSON',
};
const SCOPE_LABEL: Record<LabScope, string> = {
  board: 'Seluruh papan',
  selection: 'Seleksi',
  frame: 'Frame',
};

/** 1×1 PNG for the fixture's `asset:logo`, so image export has something to embed. */
const LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** Two frames next to the release fixture, so the frame scope has something to show. */
function seedFrames(board: Board): void {
  const retro = board.create({
    type: 'frame',
    x: 0,
    y: 900,
    w: 620,
    h: 380,
    props: { name: 'Retro Sprint', fill: 'surface', clip: true },
  });
  if (retro) {
    board.create({
      type: 'sticky',
      parentId: retro.id,
      x: 40,
      y: 960,
      w: 200,
      h: 200,
      props: { text: [{ insert: 'Yang berjalan baik\n' }], color: 'green', authorId: null },
    });
    board.create({
      type: 'sticky',
      parentId: retro.id,
      x: 280,
      y: 960,
      w: 200,
      h: 200,
      props: { text: [{ insert: 'Perlu diperbaiki\n' }], color: 'pink', authorId: null },
    });
  }
  const plan = board.create({
    type: 'frame',
    x: 700,
    y: 900,
    w: 520,
    h: 380,
    props: { name: 'Rencana', fill: 'surface', clip: true },
  });
  if (plan) {
    board.create({
      type: 'geo',
      parentId: plan.id,
      x: 760,
      y: 980,
      w: 200,
      h: 120,
      props: {
        geo: 'rounded-rectangle',
        fill: 'semi',
        fillColor: 'blue',
        strokeColor: 'blue',
        strokeWidth: 2,
        dash: 'solid',
        textColor: 'blue',
        label: [{ insert: 'Langkah 1\n' }],
      },
    });
  }
}

export default defineScenario({
  id: 'export-lab',
  title: 'Lab ekspor',
  description: 'Pratinjau ekspor PNG, SVG, teks, dan JSON untuk papan, seleksi, atau frame.',
  order: 45,
  layout: 'lab',
  mount({ main, controls, debug, state, expose }) {
    const board = createBoard({
      locale: 'id',
      plugins: [defaultCommands, defaultElements, defaultTools],
      document: kitchenSink,
      assets: { resolve: (id) => (id === 'asset:logo' ? LOGO : null) },
    });
    seedFrames(board);
    board.history.clear();
    expose(board);

    let options: LabOptions = readLabOptions(state);

    // ---------- Layout: board and preview side by side ----------
    const boardPane = h('div', {
      style: 'position:relative;min-width:0;min-height:0;border-right:1px solid var(--border)',
    });
    const meta = h('div', { class: 'status', dataset: { testid: 'export-meta' } }, '…');
    const warnings = h('ul', {
      class: 'muted',
      style: 'font-size:12px;padding-left:18px;margin:0',
      dataset: { testid: 'export-warnings' },
    });
    const preview = h('div', {
      dataset: { testid: 'export-preview' },
      style:
        'flex:1;min-height:0;overflow:auto;border:1px solid var(--border);border-radius:6px;' +
        // Checkerboard, so a transparent background is visible.
        'background:repeating-conic-gradient(#8883 0 25%,transparent 0 50%) 0 0/16px 16px',
    });
    const previewPane = h(
      'div',
      { style: 'display:flex;flex-direction:column;gap:8px;padding:8px;min-width:0;min-height:0' },
      meta,
      warnings,
      preview,
    );
    main.append(
      h(
        'div',
        {
          style:
            'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);height:100%;min-height:0',
        },
        boardPane,
        previewPane,
      ),
    );

    const view = mountRenderer(board, boardPane, { background: 'dots' });
    const textEditor = attachTextEditor(view);
    // No default UI: its toolbar does not fit the half-width pane. Shortcuts still work.
    board.setTool('select');
    // After the first layout, once the view knows its size.
    const fitFrame = requestAnimationFrame(() => board.camera.zoomToFit());

    // ---------- Controls ----------
    const formatSelect = h(
      'select',
      { dataset: { testid: 'export-format' } },
      ...LAB_FORMATS.map((f) => h('option', { value: f }, FORMAT_LABEL[f])),
    );
    const scopeSelect = h('select', { dataset: { testid: 'export-scope' } });
    const scaleSelect = h(
      'select',
      { dataset: { testid: 'export-scale' } },
      ...LAB_SCALES.map((s) => h('option', { value: String(s) }, `${s}×`)),
    );
    const bgSelect = h(
      'select',
      { dataset: { testid: 'export-bg' } },
      h('option', { value: 'theme' }, 'Tema papan'),
      h('option', { value: 'transparent' }, 'Transparan'),
      h('option', { value: 'custom' }, 'Warna sendiri'),
    );
    const bgColor = h('input', { type: 'color', value: '#ffffff' });
    const paddingInput = h('input', {
      type: 'number',
      min: '0',
      max: '512',
      step: '4',
      placeholder: 'bawaan',
      style: 'width:90px',
      dataset: { testid: 'export-padding' },
    });
    const autoRefresh = h('input', { type: 'checkbox', checked: true });
    const refreshButton = h(
      'button',
      { type: 'button', onclick: () => void refresh() },
      'Perbarui',
    );
    const downloadButton = h(
      'button',
      { type: 'button', disabled: true, dataset: { testid: 'export-download' } },
      'Unduh',
    );
    const imageOnly = h(
      'div',
      { style: 'display:flex;flex-direction:column;gap:8px' },
      h('label', { class: 'row' }, 'Skala ', scaleSelect),
      h('label', { class: 'row' }, 'Latar ', bgSelect, bgColor),
      h('label', { class: 'row' }, 'Padding ', paddingInput),
    );

    function fillScopes(): void {
      const frames = listFrames(board);
      const current = options.scope === 'frame' ? `frame:${options.frameId}` : options.scope;
      scopeSelect.replaceChildren(
        h('option', { value: 'board' }, SCOPE_LABEL.board),
        h('option', { value: 'selection' }, `${SCOPE_LABEL.selection} (${board.selection.length})`),
        ...frames.map((f) =>
          h('option', { value: `frame:${f.id}` }, `${SCOPE_LABEL.frame}: ${f.name}`),
        ),
      );
      scopeSelect.value = current;
      if (scopeSelect.value !== current) scopeSelect.value = 'board';
    }

    function syncControls(): void {
      formatSelect.value = options.format;
      fillScopes();
      scaleSelect.value = String(options.scale);
      const custom = options.background !== 'theme' && options.background !== 'transparent';
      bgSelect.value = custom ? 'custom' : options.background;
      bgColor.hidden = !custom;
      if (custom) bgColor.value = options.background;
      paddingInput.value = options.padding === null ? '' : String(options.padding);
      // Scale, background, and padding only apply to images.
      imageOnly.hidden = options.format === 'text' || options.format === 'json';
    }

    function readControls(): LabOptions {
      const scope = scopeSelect.value;
      const padding = paddingInput.value.trim();
      return {
        format: formatSelect.value as LabFormat,
        scope: scope.startsWith('frame:') ? 'frame' : (scope as LabScope),
        frameId: scope.startsWith('frame:') ? scope.slice(6) : null,
        scale: Number(scaleSelect.value),
        background: bgSelect.value === 'custom' ? bgColor.value : bgSelect.value,
        padding: padding === '' ? null : Math.max(0, Number(padding)),
      };
    }

    function onControlsChange(): void {
      options = readControls();
      writeLabOptions(state, options);
      syncControls();
      void refresh();
    }
    for (const el of [formatSelect, scopeSelect, scaleSelect, bgSelect, bgColor, paddingInput]) {
      el.addEventListener('change', onControlsChange);
    }

    controls.append(
      section('Format', formatSelect),
      section('Cakupan', scopeSelect),
      section('Gambar (PNG dan SVG)', imageOnly),
      section(
        'Hasil',
        h('label', { class: 'row' }, autoRefresh, ' Perbarui otomatis saat papan berubah'),
        h('div', { class: 'row' }, refreshButton, downloadButton),
      ),
    );

    // ---------- Export and preview ----------
    let objectUrl: string | null = null;
    let latest: LabResult | null = null;
    let run = 0;
    let disposed = false;

    function revoke(): void {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }

    function show(result: LabResult): void {
      revoke();
      latest = result;
      downloadButton.disabled = false;
      const size =
        result.width !== null
          ? ` · ${result.width} × ${result.height} px`
          : result.pages !== undefined
            ? ` · ${result.pages} halaman`
            : '';
      const usedScale =
        result.scale !== null && result.scale !== options.scale
          ? ` · skala diturunkan ke ${result.scale.toFixed(2)}×`
          : '';
      meta.className = result.warnings.length > 0 ? 'status warn' : 'status ok';
      meta.textContent =
        `${FORMAT_LABEL[result.format]} · ${formatBytes(result.blob.size)}${size}` +
        `${usedScale} · ${result.ms.toFixed(0)} ms`;
      warnings.replaceChildren(
        ...result.warnings.map((w) =>
          h(
            'li',
            {},
            w.elementId ? `${w.code} (${w.elementId}): ${w.message}` : `${w.code}: ${w.message}`,
          ),
        ),
      );

      if (result.format === 'png' || result.format === 'svg') {
        // An <img> never runs scripts inside an SVG.
        objectUrl = URL.createObjectURL(result.blob);
        const img = h('img', {
          src: objectUrl,
          alt: `Pratinjau ekspor ${FORMAT_LABEL[result.format]}`,
          style: 'display:block;max-width:100%;height:auto;margin:auto',
        });
        const children: Node[] = [img];
        if (result.format === 'svg' && result.text !== null) {
          children.push(
            h(
              'details',
              { style: 'margin:8px' },
              h('summary', {}, 'Sumber SVG'),
              h('pre', { style: 'max-height:300px;overflow:auto' }, result.text),
            ),
          );
        }
        preview.replaceChildren(...children);
      } else if (result.format === 'pdf') {
        // The browser's PDF viewer; a sandboxed frame would block it.
        objectUrl = URL.createObjectURL(result.blob);
        preview.replaceChildren(
          h('iframe', {
            src: objectUrl,
            title: 'Pratinjau ekspor PDF',
            style: 'display:block;width:100%;height:100%;min-height:480px;border:0',
          }),
        );
      } else {
        preview.replaceChildren(
          h(
            'pre',
            { style: 'margin:0;min-height:100%;border:0;border-radius:0' },
            result.text ?? '',
          ),
        );
      }
    }

    function showError(error: unknown): void {
      revoke();
      latest = null;
      downloadButton.disabled = true;
      meta.className = error instanceof LabScopeError ? 'status warn' : 'status error';
      meta.textContent = error instanceof Error ? error.message : String(error);
      warnings.replaceChildren();
      preview.replaceChildren();
    }

    async function refresh(): Promise<void> {
      const id = ++run;
      meta.className = 'status';
      meta.textContent = 'Mengekspor…';
      try {
        const result = await runLabExport(board, options);
        if (id === run && !disposed) show(result);
      } catch (error) {
        if (id === run && !disposed) showError(error);
      }
    }

    downloadButton.addEventListener('click', () => {
      if (!latest) return;
      const url = URL.createObjectURL(latest.blob);
      const a = h('a', { href: url, download: latest.fileName });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });

    // Board edits refresh the preview after a short pause; the selection list follows selection.
    let timer: ReturnType<typeof setTimeout> | null = null;
    function scheduleRefresh(): void {
      if (!autoRefresh.checked) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 400);
    }
    const offChange = board.on('change', () => {
      fillScopes();
      scheduleRefresh();
    });
    const offSelection = board.on('selection', () => {
      fillScopes();
      if (options.scope === 'selection') scheduleRefresh();
    });
    const offTheme = board.on('theme', scheduleRefresh);

    debug.append(
      section(
        'Catatan',
        h(
          'ul',
          { class: 'muted', style: 'font-size:12px;padding-left:18px' },
          h(
            'li',
            {},
            'PNG memakai skala 1 sampai 4 piksel per unit papan; skala turun otomatis bila melewati batas kanvas.',
          ),
          h(
            'li',
            {},
            'SVG menyematkan gambar sebagai data URL; teks dan JSON mengabaikan skala, latar, dan padding.',
          ),
          h('li', {}, 'Frame dipotong sesuai batasnya, dengan padding bawaan 0.'),
        ),
      ),
    );

    syncControls();
    void refresh();

    return () => {
      disposed = true;
      cancelAnimationFrame(fitFrame);
      if (timer) clearTimeout(timer);
      offChange();
      offSelection();
      offTheme();
      revoke();
      textEditor.detach();
      view.unmount();
      board.dispose();
    };
  },
});
