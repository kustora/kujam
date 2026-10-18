import { createBoard, type Board } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import {
  attachTextEditor,
  defaultElements,
  defaultTools,
  DEFAULT_ELEMENT_TYPES,
  DEFAULT_TOOL_IDS,
} from '@kujam/shapes';
import { h, json, section } from '../dom.js';
import { defineScenario } from '../scenario.js';

function seedDemoElements(board: Board): void {
  // Title
  board.create({
    type: 'text',
    x: 80,
    y: 40,
    w: 500,
    h: 50,
    props: {
      text: [
        { insert: 'Whiteboard Agnostik @kujam/*\n', attributes: { bold: true } },
        { insert: 'Pratinjau interaktif: sticky note, shapes, coretan, teks, dan editor HTML.\n' },
      ],
      color: 'black',
      fontSize: 20,
      align: 'start',
      autoWidth: true,
    },
  });

  // Sticky 1: Yellow with formatting
  board.create({
    type: 'sticky',
    x: 80,
    y: 130,
    w: 200,
    h: 200,
    props: {
      text: [
        { insert: 'Halo dari Sticky! 💡\n', attributes: { bold: true } },
        { insert: 'Klik 2x untuk edit teks.\n' },
        { insert: 'Bisa teks tebal' },
        { insert: '\n', attributes: { list: 'bullet' } },
        { insert: 'Bisa teks miring' },
        { insert: '\n', attributes: { list: 'bullet' } },
      ],
      color: 'yellow',
      authorId: null,
    },
  });

  // Sticky 2: Green
  board.create({
    type: 'sticky',
    x: 310,
    y: 130,
    w: 200,
    h: 200,
    props: {
      text: [
        { insert: 'Auto-Font Sticky\n', attributes: { bold: true } },
        { insert: 'Ukuran font mengecil secara dinamis agar seluruh teks muat dalam sticky note.\n' },
      ],
      color: 'green',
      authorId: null,
    },
  });

  // Geometric shape: Diamond
  board.create({
    type: 'geo',
    x: 540,
    y: 150,
    w: 160,
    h: 160,
    props: {
      geo: 'diamond',
      fill: 'semi',
      fillColor: 'blue',
      strokeColor: 'blue',
      strokeWidth: 3,
      dash: 'dashed',
      textColor: 'blue',
      label: [{ insert: 'Mulai\n', attributes: { bold: true } }],
    },
  });

  // Geometric shape: Rounded Rectangle
  board.create({
    type: 'geo',
    x: 740,
    y: 150,
    w: 180,
    h: 140,
    props: {
      geo: 'rounded-rectangle',
      fill: 'solid',
      fillColor: 'yellow',
      strokeColor: 'black',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'black',
      label: [{ insert: 'Proses\n', attributes: { bold: true } }],
    },
  });

  // Geometric shape: Star
  board.create({
    type: 'geo',
    x: 960,
    y: 150,
    w: 150,
    h: 150,
    props: {
      geo: 'star',
      fill: 'solid',
      fillColor: 'orange',
      strokeColor: 'red',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'white',
      label: [{ insert: 'Bintang\n', attributes: { bold: true } }],
    },
  });

  // Geometric shape: Arrow
  board.create({
    type: 'geo',
    x: 540,
    y: 350,
    w: 180,
    h: 90,
    props: {
      geo: 'arrow',
      fill: 'semi',
      fillColor: 'purple',
      strokeColor: 'purple',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'purple',
      label: [{ insert: 'Alur\n' }],
    },
  });

  // Freehand drawing stroke
  board.create({
    type: 'draw',
    x: 80,
    y: 370,
    w: 320,
    h: 100,
    props: {
      points: [
        [80, 420, 0.4],
        [130, 390, 0.7],
        [190, 440, 0.9],
        [250, 385, 0.6],
        [320, 450, 0.5],
        [390, 410, 0.2],
      ],
      color: 'red',
      thickness: 6,
      brush: 'highlighter',
    },
  });
}

export default defineScenario({
  id: 'empty',
  title: 'Papan interaktif',
  description: 'Papan whiteboard lengkap dengan elemen bawaan, tool interaktif, dan inline editor.',
  order: 0,
  layout: 'board',
  mount({ main, controls, debug }) {
    const board = createBoard({
      locale: 'id',
      plugins: [defaultElements, defaultTools],
    });

    // Mount canvas renderer and attach inline text editor
    const view = mountRenderer(board, main);
    const textEditor = attachTextEditor(view);

    // Initial tool
    board.setTool('select');

    // Seed sample elements
    seedDemoElements(board);

    // Zoom to fit or keep initial camera
    board.camera.setViewport({ width: main.clientWidth || 1200, height: main.clientHeight || 800 });

    // ---------- Controls Panel ----------
    const toolList = [
      { id: 'select', label: '↖️ Pilih (V)' },
      { id: 'hand', label: '✋ Tangan (H)' },
      { id: 'sticky', label: '📝 Sticky (S)' },
      { id: 'draw', label: '✏️ Pena (P)' },
      { id: 'text', label: '🔤 Teks (T)' },
      { id: 'rectangle', label: '◻️ Kotak (R)' },
      { id: 'ellipse', label: '⬭ Elips (O)' },
      { id: 'eraser', label: '🧹 Hapus (E)' },
    ];

    const toolButtons: Record<string, HTMLButtonElement> = {};
    const toolContainer = h('div', { class: 'row wrap' });

    function updateActiveToolButton(activeId: string | null): void {
      for (const [id, btn] of Object.entries(toolButtons)) {
        btn.style.borderColor = id === activeId ? 'var(--accent)' : 'var(--border)';
        btn.style.backgroundColor = id === activeId ? '#3b82f633' : '#273449';
      }
    }

    for (const tool of toolList) {
      const btn = h(
        'button',
        {
          type: 'button',
          onclick: () => {
            board.setTool(tool.id);
          },
        },
        tool.label,
      );
      toolButtons[tool.id] = btn;
      toolContainer.appendChild(btn);
    }
    updateActiveToolButton(board.tool);

    const offTool = board.on('tool', (e) => {
      updateActiveToolButton(e.id);
    });

    // Zoom & Navigation
    const zoomInBtn = h('button', { type: 'button', onclick: () => board.camera.zoomBy(1.2) }, '➕ Zoom In');
    const zoomOutBtn = h('button', { type: 'button', onclick: () => board.camera.zoomBy(1 / 1.2) }, '➖ Zoom Out');
    const zoomResetBtn = h('button', { type: 'button', onclick: () => board.camera.zoomTo(1) }, '100%');
    const zoomFitBtn = h('button', { type: 'button', onclick: () => board.camera.zoomToFit() }, '🎯 Fit');
    const navRow = h('div', { class: 'row wrap' }, zoomInBtn, zoomOutBtn, zoomResetBtn, zoomFitBtn);

    // History
    const undoBtn = h('button', { type: 'button', onclick: () => board.undo() }, '↩️ Undo');
    const redoBtn = h('button', { type: 'button', onclick: () => board.redo() }, '↪️ Redo');
    const historyRow = h('div', { class: 'row' }, undoBtn, redoBtn);

    // Theme Toggle
    let isDark = false;
    const themeBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          isDark = !isDark;
          board.setTheme(isDark ? 'dark' : 'light');
          themeBtn.textContent = isDark ? '🌙 Tema: Gelap' : '☀️ Tema: Terang';
        },
      },
      '☀️ Tema: Terang',
    );

    // Board background (BOARD-1007)
    const backgroundLabels = { dots: '⋯ Latar: Titik', grid: '▦ Latar: Grid', none: '▢ Latar: Polos' } as const;
    const backgroundOrder = ['dots', 'grid', 'none'] as const;
    const backgroundBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const next = backgroundOrder[(backgroundOrder.indexOf(view.background) + 1) % backgroundOrder.length]!;
          view.background = next;
          backgroundBtn.textContent = backgroundLabels[next];
        },
      },
      backgroundLabels[view.background],
    );

    // Reset / Seed Buttons
    const resetSampleBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const recs = Object.values(board.getDocument().records).filter((r) => r.kind === 'element');
          board.delete(recs.map((r) => r.id));
          seedDemoElements(board);
        },
      },
      '🔄 Muat Ulang Contoh',
    );

    const clearBtn = h(
      'button',
      {
        type: 'button',
        class: 'ghost',
        onclick: () => {
          const recs = Object.values(board.getDocument().records).filter((r) => r.kind === 'element');
          board.delete(recs.map((r) => r.id));
        },
      },
      '🗑️ Kosongkan Papan',
    );

    controls.append(
      section('Tool Aktif', toolContainer),
      section('Navigasi & Zoom', navRow),
      section('Riwayat', historyRow),
      section('Tampilan', h('div', { class: 'row wrap' }, themeBtn, backgroundBtn)),
      section('Aksi', h('div', { class: 'row wrap' }, resetSampleBtn, clearBtn)),
      section(
        'Petunjuk Interaksi',
        h(
          'ul',
          { class: 'muted', style: 'padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 13px;' },
          h('li', {}, 'Klik elemen untuk memilih dan menggeser.'),
          h('li', {}, 'Shift + Drag sudut handle untuk mengunci rasio aspek.'),
          h('li', {}, 'Klik 2x pada sticky, teks, atau bentuk untuk mengedit teks secara inline.'),
          h('li', {}, 'Shortcut: V (Pilih), H (Tangan), S (Sticky), P (Pena), T (Teks), R (Kotak), O (Elips), E (Hapus).'),
        ),
      ),
    );

    // ---------- Debug Panel ----------
    const docPre = h('pre', { style: 'font-size: 11px; max-height: 250px; overflow: auto;' }, json(board.getDocument()));
    const camPre = h('pre', { style: 'font-size: 11px;' }, json(board.getCamera()));
    const selPre = h('pre', { style: 'font-size: 11px;' }, json(board.selection));

    function updateDebug(): void {
      docPre.textContent = json(board.getDocument());
      camPre.textContent = json(board.getCamera());
      selPre.textContent = json(board.selection);
    }

    const offChange = board.on('change', updateDebug);
    const offCamera = board.on('camera', updateDebug);
    const offSelection = board.on('selection', updateDebug);

    debug.append(
      section('Seleksi Aktif', selPre),
      section('Kamera', camPre),
      section(
        'Dokumen',
        h(
          'p',
          { class: 'muted', style: 'font-size: 12px; margin-bottom: 6px;' },
          `Tipe terdaftar: ${DEFAULT_ELEMENT_TYPES.length} · Tool: ${DEFAULT_TOOL_IDS.length}`,
        ),
        docPre,
      ),
    );

    return () => {
      offTool();
      offChange();
      offCamera();
      offSelection();
      textEditor.detach();
      view.unmount();
      board.dispose();
    };
  },
});
