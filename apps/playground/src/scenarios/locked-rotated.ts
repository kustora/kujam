/**
 * Scenario dedicated to locked elements (locked: true), rotated shapes, and nested arrangements (BOARD-2403).
 */

import { createBoard, defaultCommands, type Board } from '@kujam/core';
import { defaultElements, defaultTools } from '@kujam/shapes';

import { BoardHarness, createBoardConfigPanel } from '../board-config.js';
import { attachDragAndDropImport, createFileIoControls } from '../file-io.js';
import { h, json, section } from '../dom.js';
import { defineScenario } from '../scenario.js';

function seedLockedRotatedElements(board: Board): void {
  // Title
  board.create({
    type: 'text',
    x: 80,
    y: 30,
    w: 700,
    h: 50,
    props: {
      text: [
        { insert: 'Uji Elemen Terkunci & Rotasi Bentuk\n', attributes: { bold: true } },
        { insert: 'Eksplorasi elemen dengan locked: true, rotasi sudut bebas, dan tumpukan layer bertingkat.\n' },
      ],
      size: 'l',
      align: 'start',
      widthMode: 'auto',
      color: 'black',
    },
  });

  // ========== 1. ELEMEN TERKUNCI (LOCKED: TRUE) ==========
  board.create({
    type: 'text',
    x: 80,
    y: 110,
    w: 300,
    h: 30,
    props: {
      text: [{ insert: '1. Elemen Terkunci (locked: true)\n', attributes: { bold: true } }],
      size: 'm',
      align: 'start',
      widthMode: 'auto',
      color: 'red',
    },
  });

  // Locked sticky note
  board.create({
    type: 'sticky',
    x: 80,
    y: 150,
    w: 200,
    h: 200,
    locked: true,
    props: {
      text: [
        { insert: '🔒 Sticky Terkunci!\n', attributes: { bold: true } },
        { insert: 'Elemen ini locked: true.\n' },
        { insert: 'Tidak bisa digeser atau diubah ukurannya oleh pengguna.\n' },
      ],
      color: 'yellow',
      authorId: 'admin',
    },
  });

  // Locked geometric badge
  board.create({
    type: 'geo',
    x: 310,
    y: 150,
    w: 190,
    h: 130,
    locked: true,
    props: {
      geo: 'rounded-rectangle',
      fill: 'solid',
      fillColor: 'red',
      strokeColor: 'red',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'white',
      label: [{ insert: '🔒 Pengaturan Kunci\n(locked: true)\n', attributes: { bold: true } }],
    },
  });

  // Unlocked comparison sticky
  board.create({
    type: 'sticky',
    x: 530,
    y: 150,
    w: 200,
    h: 200,
    locked: false,
    props: {
      text: [
        { insert: '🔓 Sticky Bebas\n', attributes: { bold: true } },
        { insert: 'Elemen ini tidak terkunci (locked: false).\n' },
        { insert: 'Bisa dipindah, diputar, dan diubah ukurannya.\n' },
      ],
      color: 'green',
      authorId: null,
    },
  });

  // ========== 2. ELEMEN TEROTASI (ROTATED SHAPES) ==========
  board.create({
    type: 'text',
    x: 80,
    y: 390,
    w: 500,
    h: 30,
    props: {
      text: [{ insert: '2. Bentuk Terotasi (Rotated Shapes)\n', attributes: { bold: true } }],
      size: 'm',
      align: 'start',
      widthMode: 'auto',
      color: 'blue',
    },
  });

  // Rotated rectangle 15 deg (0.26 rad)
  board.create({
    type: 'geo',
    x: 80,
    y: 450,
    w: 170,
    h: 110,
    rotation: 0.26,
    props: {
      geo: 'rectangle',
      fill: 'semi',
      fillColor: 'blue',
      strokeColor: 'blue',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'blue',
      label: [{ insert: 'Rotasi +15°\n' }],
    },
  });

  // Rotated diamond 45 deg (0.785 rad)
  board.create({
    type: 'geo',
    x: 290,
    y: 440,
    w: 140,
    h: 140,
    rotation: 0.785,
    props: {
      geo: 'diamond',
      fill: 'solid',
      fillColor: 'purple',
      strokeColor: 'purple',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'white',
      label: [{ insert: 'Rotasi 45°\n' }],
    },
  });

  // Rotated star 72 deg (1.256 rad)
  board.create({
    type: 'geo',
    x: 480,
    y: 430,
    w: 150,
    h: 150,
    rotation: 1.256,
    props: {
      geo: 'star',
      fill: 'semi',
      fillColor: 'orange',
      strokeColor: 'red',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'red',
      label: [{ insert: 'Bintang 72°\n' }],
    },
  });

  // Rotated arrow -30 deg (-0.52 rad)
  board.create({
    type: 'geo',
    x: 680,
    y: 460,
    w: 180,
    h: 90,
    rotation: -0.52,
    props: {
      geo: 'arrow',
      fill: 'solid',
      fillColor: 'green',
      strokeColor: 'green',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'white',
      label: [{ insert: 'Panah -30°\n' }],
    },
  });

  // Rotated text 90 deg (1.57 rad)
  board.create({
    type: 'text',
    x: 920,
    y: 440,
    w: 180,
    h: 40,
    rotation: 1.57,
    props: {
      text: [{ insert: 'Teks Vertikal 90°\n', attributes: { bold: true } }],
      size: 'm',
      align: 'start',
      widthMode: 'auto',
      color: 'purple',
    },
  });

  // ========== 3. TATA LETAK BERTINGKAT / BERLAPIS (LAYERED STACK) ==========
  board.create({
    type: 'text',
    x: 800,
    y: 110,
    w: 400,
    h: 30,
    props: {
      text: [{ insert: '3. Tata Letak Berlapis (Layering / Z-Index)\n', attributes: { bold: true } }],
      size: 'm',
      align: 'start',
      widthMode: 'auto',
      color: 'purple',
    },
  });

  // Base background card (lowest layer index: a0)
  board.create({
    type: 'geo',
    x: 820,
    y: 160,
    w: 320,
    h: 220,
    props: {
      geo: 'rounded-rectangle',
      fill: 'semi',
      fillColor: 'grey',
      strokeColor: 'black',
      strokeWidth: 1,
      dash: 'dashed',
      textColor: 'black',
      label: [{ insert: 'Lapisan Dasar (Bawah)\n' }],
    },
  });

  // Middle card (index: a1)
  board.create({
    type: 'geo',
    x: 870,
    y: 200,
    w: 220,
    h: 150,
    rotation: 0.1,
    props: {
      geo: 'rectangle',
      fill: 'solid',
      fillColor: 'blue',
      strokeColor: 'blue',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'white',
      label: [{ insert: 'Lapisan Tengah\n' }],
    },
  });

  // Top sticky note (highest layer)
  board.create({
    type: 'sticky',
    x: 930,
    y: 230,
    w: 150,
    h: 150,
    rotation: -0.15,
    props: {
      text: [{ insert: 'Lapisan Teratas!\nKlik untuk pilih.\n', attributes: { bold: true } }],
      color: 'yellow',
      authorId: null,
    },
  });
}

export default defineScenario({
  id: 'locked-rotated',
  title: 'Elemen Terkunci & Rotasi',
  description: 'Skenario pengujian untuk elemen terkunci (locked: true), rotasi sudut bebas, dan susunan bertingkat.',
  order: 2,
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

    seedLockedRotatedElements(board);
    board.camera.setViewport({ width: main.clientWidth || 1200, height: main.clientHeight || 800 });

    const detachDnd = attachDragAndDropImport(main, () => board);

    // Specific controls for lock and rotation
    const toggleLockBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const selectedIds = board.selection;
          if (selectedIds.length === 0) {
            alert('Pilih setidaknya satu elemen untuk mengubah status penguncian.');
            return;
          }
          for (const id of selectedIds) {
            const el = board.getElement(id);
            if (el) {
              board.update(id, { locked: !el.locked });
            }
          }
        },
      },
      '🔒 Beralih Kunci (Lock/Unlock)',
    );

    const rotate15Btn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const selectedIds = board.selection;
          for (const id of selectedIds) {
            const el = board.getElement(id);
            if (el && !el.locked) {
              board.update(id, { rotation: (el.rotation + (15 * Math.PI) / 180) % (2 * Math.PI) });
            }
          }
        },
      },
      '🔄 Putar +15°',
    );

    const rotateMinus15Btn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const selectedIds = board.selection;
          for (const id of selectedIds) {
            const el = board.getElement(id);
            if (el && !el.locked) {
              board.update(id, { rotation: (el.rotation - (15 * Math.PI) / 180) % (2 * Math.PI) });
            }
          }
        },
      },
      '🔄 Putar -15°',
    );

    const resetRotationBtn = h(
      'button',
      {
        type: 'button',
        class: 'ghost',
        onclick: () => {
          const selectedIds = board.selection;
          for (const id of selectedIds) {
            const el = board.getElement(id);
            if (el && !el.locked) {
              board.update(id, { rotation: 0 });
            }
          }
        },
      },
      '↺ Reset Rotasi 0°',
    );

    const lockControls = h('div', { class: 'column', style: 'display: flex; flex-direction: column; gap: 8px;' },
      toggleLockBtn,
      h('div', { class: 'row wrap' }, rotate15Btn, rotateMinus15Btn, resetRotationBtn),
    );

    // Zoom & History
    const zoomInBtn = h('button', { type: 'button', onclick: () => board.camera.zoomBy(1.2) }, '➕ Zoom In');
    const zoomOutBtn = h('button', { type: 'button', onclick: () => board.camera.zoomBy(1 / 1.2) }, '➖ Zoom Out');
    const zoomFitBtn = h('button', { type: 'button', onclick: () => board.camera.zoomToFit() }, '🎯 Fit');
    const undoBtn = h('button', { type: 'button', onclick: () => board.undo() }, '↩️ Undo');
    const redoBtn = h('button', { type: 'button', onclick: () => board.redo() }, '↪️ Redo');

    const configPanel = createBoardConfigPanel(harness);
    const fileIoPanel = createFileIoControls(() => board);

    controls.append(
      section('Manipulasi Kunci & Rotasi', lockControls),
      section('Navigasi & Riwayat', h('div', { class: 'row wrap' }, zoomInBtn, zoomOutBtn, zoomFitBtn, undoBtn, redoBtn)),
      section('File I/O Dokumen', fileIoPanel),
      section('Konfigurasi Papan', configPanel),
    );

    // Debug Panel
    const selPre = h('pre', { style: 'font-size: 11px;' }, json(board.selection));
    const docPre = h('pre', { style: 'font-size: 11px; max-height: 250px; overflow: auto;' }, json(board.getDocument()));

    function updateDebug(): void {
      selPre.textContent = json(board.selection);
      docPre.textContent = json(board.getDocument());
    }

    const offChange = board.on('change', updateDebug);
    const offSelection = board.on('selection', updateDebug);

    debug.append(
      section('Seleksi Aktif', selPre),
      section('Dokumen', docPre),
    );

    return () => {
      offChange();
      offSelection();
      detachDnd();
      harness.destroy();
      board.dispose();
    };
  },
});
