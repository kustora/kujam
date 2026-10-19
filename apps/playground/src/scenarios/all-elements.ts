/**
 * Kitchen-sink scenario containing all built-in 0.1 elements and visual demonstration (BOARD-2403).
 */

import { createBoard, defaultCommands, type Board } from '@kujam/core';
import { defaultElements, defaultTools } from '@kujam/shapes';

import { BoardHarness, createBoardConfigPanel } from '../board-config.js';
import { attachDragAndDropImport, createFileIoControls } from '../file-io.js';
import { h, json, section } from '../dom.js';
import { defineScenario } from '../scenario.js';

function seedAllElements(board: Board): void {
  // 1. Header / Title Text
  board.create({
    type: 'text',
    x: 80,
    y: 30,
    w: 700,
    h: 50,
    props: {
      text: [
        { insert: 'Showcase Lengkap Elemen Whiteboard (0.1.0)\n', attributes: { bold: true } },
        { insert: 'Demonstrasi seluruh elemen bawaan: sticky note, bentuk geometri, coretan bebas, dan binding.\n' },
      ],
      size: 'l',
      align: 'start',
      widthMode: 'auto',
      color: 'black',
    },
  });

  // 2. Sticky Notes Palette (6 official pastel colors from DESIGN.md)
  const stickyColors = ['yellow', 'green', 'pink', 'blue', 'purple', 'gray'] as const;
  const stickyLabels = [
    'Sticky Kuning\n• Ide utama\n• Prioritas tinggi',
    'Sticky Hijau\n• Selesai diuji\n• Siap rilis',
    'Sticky Merah Muda\n• Desain token\n• WCAG AAA',
    'Sticky Biru\n• Arsitektur DOM-free\n• Monorepo pnpm',
    'Sticky Ungu\n• Konektor & binding\n• Anchor dinamis',
    'Sticky Abu-abu\n• Catatan umum\n• Dokumentasi',
  ];

  stickyColors.forEach((color, idx) => {
    board.create({
      type: 'sticky',
      x: 80 + (idx % 3) * 220,
      y: 110 + Math.floor(idx / 3) * 210,
      w: 190,
      h: 180,
      props: {
        text: [{ insert: `${stickyLabels[idx]}\n` }],
        color,
        authorId: idx % 2 === 0 ? 'user:alice' : null,
      },
    });
  });

  // 3. Freehand Drawings (Pen and Highlighter)
  board.create({
    type: 'draw',
    x: 80,
    y: 550,
    w: 300,
    h: 80,
    props: {
      points: [
        [30, 40, 0.4],
        [90, 20, 0.7],
        [150, 50, 0.9],
        [220, 25, 0.6],
        [280, 55, 0.3],
      ],
      color: 'red',
      thickness: 6,
      brush: 'pen',
    },
  });

  board.create({
    type: 'draw',
    x: 420,
    y: 550,
    w: 300,
    h: 80,
    props: {
      points: [
        [30, 30, 0.5],
        [90, 60, 0.8],
        [160, 35, 0.6],
        [230, 55, 0.7],
        [290, 30, 0.4],
      ],
      color: 'yellow',
      thickness: 18,
      brush: 'highlighter',
    },
  });

  // 4. Geometric Shapes: All 8 kinds (rectangle, rounded-rectangle, ellipse, diamond, triangle, parallelogram, star, arrow)
  const idRect = board.create({
    type: 'geo',
    x: 770,
    y: 110,
    w: 180,
    h: 120,
    props: {
      geo: 'rectangle',
      fill: 'semi',
      fillColor: 'blue',
      strokeColor: 'blue',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'blue',
      label: [{ insert: 'Kotak (Rect)\n', attributes: { bold: true } }],
    },
  })?.id;

  const idRounded = board.create({
    type: 'geo',
    x: 990,
    y: 110,
    w: 180,
    h: 120,
    props: {
      geo: 'rounded-rectangle',
      fill: 'solid',
      fillColor: 'green',
      strokeColor: 'green',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'white',
      label: [{ insert: 'Sudut Bulat\n', attributes: { bold: true } }],
    },
  })?.id;

  board.create({
    type: 'geo',
    x: 1210,
    y: 110,
    w: 180,
    h: 120,
    props: {
      geo: 'ellipse',
      fill: 'semi',
      fillColor: 'purple',
      strokeColor: 'purple',
      strokeWidth: 2,
      dash: 'dashed',
      textColor: 'purple',
      label: [{ insert: 'Elips (Oval)\n' }],
    },
  });

  const idDiamond = board.create({
    type: 'geo',
    x: 770,
    y: 270,
    w: 170,
    h: 150,
    props: {
      geo: 'diamond',
      fill: 'solid',
      fillColor: 'yellow',
      strokeColor: 'orange',
      strokeWidth: 3,
      dash: 'solid',
      textColor: 'black',
      label: [{ insert: 'Belah Ketupat\n(Keputusan)\n', attributes: { bold: true } }],
    },
  })?.id;

  board.create({
    type: 'geo',
    x: 990,
    y: 270,
    w: 180,
    h: 150,
    props: {
      geo: 'triangle',
      fill: 'semi',
      fillColor: 'red',
      strokeColor: 'red',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'red',
      label: [{ insert: 'Segitiga\n' }],
    },
  });

  board.create({
    type: 'geo',
    x: 1210,
    y: 270,
    w: 190,
    h: 130,
    props: {
      geo: 'parallelogram',
      fill: 'semi',
      fillColor: 'grey',
      strokeColor: 'black',
      strokeWidth: 2,
      dash: 'dotted',
      textColor: 'black',
      label: [{ insert: 'Jajaran Genjang\n' }],
    },
  });

  board.create({
    type: 'geo',
    x: 770,
    y: 450,
    w: 160,
    h: 160,
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

  const idArrow = board.create({
    type: 'geo',
    x: 990,
    y: 470,
    w: 200,
    h: 100,
    props: {
      geo: 'arrow',
      fill: 'semi',
      fillColor: 'blue',
      strokeColor: 'blue',
      strokeWidth: 3,
      dash: 'solid',
      textColor: 'blue',
      label: [{ insert: 'Alur Proses\n' }],
    },
  })?.id;

  // 5. Connectors / Bindings between elements
  if (board.elements.has('connector')) {
    if (idRect && idDiamond) {
      const startBindingId = board.createId();
      const endBindingId = board.createId();
      const conn = board.create({
        type: 'connector',
        x: 855,
        y: 230,
        w: 5,
        h: 40,
        props: {
          start: { x: 5, y: 0 },
          end: { x: 0, y: 40 },
          startBindingId,
          endBindingId,
          connectorStyle: 'straight',
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
            toId: idRect,
            anchor: { x: 0.5, y: 1 },
          });
          tx.put({
            id: endBindingId,
            kind: 'binding',
            fromId: conn.id,
            toId: idDiamond,
            anchor: { x: 0.5, y: 0 },
          });
        });
      }
    }

    if (idDiamond && idArrow) {
      const startBindingId = board.createId();
      const endBindingId = board.createId();
      const conn = board.create({
        type: 'connector',
        x: 940,
        y: 345,
        w: 50,
        h: 175,
        props: {
          start: { x: 0, y: 0 },
          end: { x: 50, y: 175 },
          startBindingId,
          endBindingId,
          connectorStyle: 'elbow',
          startArrow: 'dot',
          endArrow: 'triangle',
          color: 'orange',
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
            toId: idDiamond,
            anchor: { x: 1, y: 0.5 },
          });
          tx.put({
            id: endBindingId,
            kind: 'binding',
            fromId: conn.id,
            toId: idArrow,
            anchor: { x: 0, y: 0.5 },
          });
        });
      }
    }

    if (idRounded && idArrow) {
      const startBindingId = board.createId();
      const endBindingId = board.createId();
      const conn = board.create({
        type: 'connector',
        x: 1080,
        y: 230,
        w: 10,
        h: 240,
        props: {
          start: { x: 0, y: 0 },
          end: { x: 10, y: 240 },
          startBindingId,
          endBindingId,
          connectorStyle: 'curved',
          startArrow: 'none',
          endArrow: 'arrow',
          color: 'green',
          strokeWidth: 2,
          dash: 'dashed',
        },
      });
      if (conn) {
        board.transact((tx) => {
          tx.put({
            id: startBindingId,
            kind: 'binding',
            fromId: conn.id,
            toId: idRounded,
            anchor: { x: 0.5, y: 1 },
          });
          tx.put({
            id: endBindingId,
            kind: 'binding',
            fromId: conn.id,
            toId: idArrow,
            anchor: { x: 0.5, y: 0 },
          });
        });
      }
    }
  } else {
    board.transact((tx) => {
      if (idRect && idDiamond) {
        tx.put({
          id: board.createId(),
          kind: 'binding',
          fromId: idRect,
          toId: idDiamond,
          anchor: { x: 0.5, y: 1 },
        });
      }

      if (idDiamond && idArrow) {
        tx.put({
          id: board.createId(),
          kind: 'binding',
          fromId: idDiamond,
          toId: idArrow,
          anchor: { x: 1, y: 0.5 },
        });
      }

      if (idRounded && idArrow) {
        tx.put({
          id: board.createId(),
          kind: 'binding',
          fromId: idRounded,
          toId: idArrow,
          anchor: { x: 0.5, y: 1 },
        });
      }
    });
  }
}

export default defineScenario({
  id: 'all-elements',
  title: 'Semua Elemen (Kitchen Sink)',
  description: 'Koleksi lengkap seluruh elemen 0.1: sticky, pena & highlighter, teks, bentuk geometri, dan binding.',
  order: 1,
  layout: 'board',
  mount({ main, controls, debug, state }) {
    const board = createBoard({
      locale: 'id',
      plugins: [defaultCommands, defaultElements, defaultTools],
    });

    const harness = new BoardHarness({
      board,
      stage: main,
      state,
      initialAdapter: (state.get('adapter') as 'vanilla' | 'react' | 'vue') ?? 'vanilla',
    });
    harness.mount();

    seedAllElements(board);
    board.camera.setViewport({ width: main.clientWidth || 1200, height: main.clientHeight || 800 });

    const detachDnd = attachDragAndDropImport(main, () => board);

    // Tools
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
      const btn = h('button', { type: 'button', onclick: () => board.setTool(tool.id) }, tool.label);
      toolButtons[tool.id] = btn;
      toolContainer.appendChild(btn);
    }
    updateActiveToolButton(board.tool);
    const offTool = board.on('tool', (e) => updateActiveToolButton(e.id));

    // Nav & Zoom
    const zoomInBtn = h('button', { type: 'button', onclick: () => board.camera.zoomBy(1.2) }, '➕ Zoom In');
    const zoomOutBtn = h('button', { type: 'button', onclick: () => board.camera.zoomBy(1 / 1.2) }, '➖ Zoom Out');
    const zoomResetBtn = h('button', { type: 'button', onclick: () => board.camera.zoomTo(1) }, '100%');
    const zoomFitBtn = h('button', { type: 'button', onclick: () => board.camera.zoomToFit() }, '🎯 Fit');
    const navRow = h('div', { class: 'row wrap' }, zoomInBtn, zoomOutBtn, zoomResetBtn, zoomFitBtn);

    // History
    const undoBtn = h('button', { type: 'button', onclick: () => board.undo() }, '↩️ Undo');
    const redoBtn = h('button', { type: 'button', onclick: () => board.redo() }, '↪️ Redo');
    const historyRow = h('div', { class: 'row' }, undoBtn, redoBtn);

    // Actions
    const resetSampleBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const recs = Object.values(board.getDocument().records).filter((r) => r.kind === 'element');
          board.delete(recs.map((r) => r.id));
          seedAllElements(board);
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

    const configPanel = createBoardConfigPanel(harness);
    const fileIoPanel = createFileIoControls(() => board);

    controls.append(
      section('Tool Aktif', toolContainer),
      section('Navigasi & Zoom', navRow),
      section('Riwayat', historyRow),
      section('File I/O Dokumen', fileIoPanel),
      section('Konfigurasi Papan', configPanel),
      section('Aksi', h('div', { class: 'row wrap' }, resetSampleBtn, clearBtn)),
    );

    // Debug Panel
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
      section('Dokumen', docPre),
    );

    return () => {
      offTool();
      offChange();
      offCamera();
      offSelection();
      detachDnd();
      harness.destroy();
      board.dispose();
    };
  },
});
