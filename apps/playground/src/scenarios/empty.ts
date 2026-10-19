import { createBoard, defaultCommands, type Board } from '@kujam/core';
import { mountRenderer, type BoardBackground } from '@kujam/renderer';
import {
  attachTextEditor,
  defaultElements,
  defaultTools,
} from '@kujam/shapes';
import { mountDefaultUi, type MountedUi } from '@kujam/ui';
import { h, section } from '../dom.js';
import { createEventLog } from '../event-log.js';
import { createPerformanceHud } from '../hud.js';
import { createInspector } from '../inspector.js';
import { attachDragAndDropImport, createFileIoControls } from '../file-io.js';
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
  const diamond = board.create({
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
  const roundedRect = board.create({
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

  // Bound connector between Diamond and Rounded Rectangle (BOARD-1101)
  if (board.elements.has('connector') && diamond && roundedRect) {
    const startBindingId = board.createId();
    const endBindingId = board.createId();
    const conn = board.create({
      type: 'connector',
      x: 700,
      y: 220,
      w: 40,
      h: 10,
      props: {
        start: { x: 0, y: 10 },
        end: { x: 40, y: 0 },
        startBindingId,
        endBindingId,
        connectorStyle: 'elbow',
        startArrow: 'none',
        endArrow: 'arrow',
        color: 'blue',
        strokeWidth: 2,
        dash: 'solid',
      },
    });
    if (conn) {
      board.transact((tx) => {
        tx.put({
          id: startBindingId,
          kind: 'binding',
          fromId: conn.id,
          toId: diamond.id,
          anchor: { x: 1, y: 0.5 },
        });
        tx.put({
          id: endBindingId,
          kind: 'binding',
          fromId: conn.id,
          toId: roundedRect.id,
          anchor: { x: 0, y: 0.5 },
        });
      });
    }
  }

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
  description: 'Papan whiteboard lengkap dengan elemen bawaan, bilah UI @kujam/ui, dan inline editor.',
  order: 0,
  layout: 'board',
  mount({ main, controls, debug, state, expose }) {
    const board = createBoard({
      locale: 'id',
      plugins: [defaultCommands, defaultElements, defaultTools],
    });
    expose(board);

    if (state.get('theme') === 'dark') {
      board.setTheme('dark');
    }

    const backgroundOrder = ['dots', 'grid', 'none'] as const;
    const backgroundLabels = {
      dots: '⋯ Latar: Titik',
      grid: '▦ Latar: Grid',
      none: '▢ Latar: Polos',
    } as const;
    const initialBg = state.get('bg');
    const background: BoardBackground =
      initialBg && backgroundOrder.includes(initialBg as (typeof backgroundOrder)[number])
        ? (initialBg as (typeof backgroundOrder)[number])
        : 'dots';

    // Mount canvas renderer and attach inline text editor
    const view = mountRenderer(board, main, { background });
    const textEditor = attachTextEditor(view);

    // Mount floating @kujam/ui controls over the board
    let ui: MountedUi | null = null;
    const setUiEnabled = (enabled: boolean) => {
      if (enabled && !ui) {
        ui = mountDefaultUi({ board, container: main });
      } else if (!enabled && ui) {
        ui.unmount();
        ui = null;
      }
      uiBtn.textContent = ui ? '🎨 UI: Aktif' : '🎨 UI: Nonaktif';
      state.set('ui', ui ? null : '0');
    };

    const uiBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => setUiEnabled(!ui),
      },
      '🎨 UI: Aktif',
    );
    setUiEnabled(state.get('ui') !== '0');

    // Mount floating Performance HUD (BOARD-2406)
    let hud: ReturnType<typeof createPerformanceHud> | null = null;
    const setHudEnabled = (enabled: boolean) => {
      if (enabled && !hud) {
        hud = createPerformanceHud(board, main);
      } else if (!enabled && hud) {
        hud.dispose();
        hud = null;
      }
      hudBtn.textContent = hud ? '⚡ HUD: Aktif' : '⚡ HUD: Nonaktif';
      state.set('hud', hud ? null : '0');
    };

    const hudBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => setHudEnabled(!hud),
      },
      '⚡ HUD: Aktif',
    );
    setHudEnabled(state.get('hud') !== '0');

    // Attach drag and drop JSON import (BOARD-2403)
    const detachDnd = attachDragAndDropImport(main, () => board);

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
      { id: 'rectangle', label: '◻️ Kotak (R)' },
      { id: 'ellipse', label: '⬭ Elips (O)' },
      { id: 'connector', label: '↗️ Konektor (L)' },
      { id: 'text', label: '🔤 Teks (T)' },
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
    const themeBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const next = board.theme.mode === 'light' ? 'dark' : 'light';
          board.setTheme(next);
          state.set('theme', next === 'light' ? null : next);
        },
      },
      board.theme.mode === 'dark' ? '🌙 Tema: Gelap' : '☀️ Tema: Terang',
    );
    const offTheme = board.on('theme', (theme) => {
      themeBtn.textContent = theme.mode === 'dark' ? '🌙 Tema: Gelap' : '☀️ Tema: Terang';
    });

    // Board background (BOARD-1007)
    const backgroundBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const next =
            backgroundOrder[(backgroundOrder.indexOf(view.background) + 1) % backgroundOrder.length]!;
          view.background = next;
          backgroundBtn.textContent = backgroundLabels[next];
          state.set('bg', next === 'dots' ? null : next);
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
      section('File I/O Dokumen', createFileIoControls(() => board)),
      section('Tampilan', h('div', { class: 'row wrap' }, uiBtn, hudBtn, themeBtn, backgroundBtn)),
      section('Aksi', h('div', { class: 'row wrap' }, resetSampleBtn, clearBtn)),
      section(
        'Petunjuk Interaksi',
        h(
          'ul',
          { class: 'muted', style: 'padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 13px;' },
          h('li', {}, 'Bilah UI mengambang (@kujam/ui): toolbar bawah tengah, kontrol riwayat (kiri), dan zoom (kanan).'),
          h('li', {}, 'Pilih warna sticky atau kuas pena langsung dari tombol toolbar.'),
          h('li', {}, 'Klik elemen untuk memilih dan menggeser.'),
          h('li', {}, 'Shift + Drag sudut handle untuk mengunci rasio aspek.'),
          h('li', {}, 'Klik 2x pada sticky, teks, atau bentuk untuk mengedit teks secara inline.'),
          h('li', {}, 'Shortcut: V (Pilih), H (Tangan), S (Sticky), P (Pena), R (Kotak), O (Elips), L (Konektor), T (Teks), E (Hapus).'),
        ),
      ),
    );

    // ---------- Debug Panel (BOARD-2404 & BOARD-2405) ----------
    const tabInspector = h('button', { type: 'button', class: 'tab-btn active' }, 'Inspector');
    const tabEventLog = h('button', { type: 'button', class: 'tab-btn' }, 'Log Event & Riwayat');
    const tabsHeader = h('div', { class: 'tabs-header' }, tabInspector, tabEventLog);

    const paneInspector = h('div', { class: 'tab-content' });
    const paneEventLog = h('div', { class: 'tab-content', hidden: true });

    tabInspector.onclick = () => {
      tabInspector.classList.add('active');
      tabEventLog.classList.remove('active');
      paneInspector.removeAttribute('hidden');
      paneEventLog.setAttribute('hidden', '');
    };

    tabEventLog.onclick = () => {
      tabEventLog.classList.add('active');
      tabInspector.classList.remove('active');
      paneEventLog.removeAttribute('hidden');
      paneInspector.setAttribute('hidden', '');
    };

    const inspector = createInspector(board, paneInspector);
    const eventLog = createEventLog(board, paneEventLog);

    const tabsContainer = h('div', { class: 'tabs-container' }, tabsHeader, paneInspector, paneEventLog);
    debug.append(tabsContainer);

    return () => {
      detachDnd();
      offTool();
      offTheme();
      inspector.dispose();
      eventLog.dispose();
      hud?.dispose();
      textEditor.detach();
      ui?.unmount();
      view.unmount();
      board.dispose();
    };
  },
});

