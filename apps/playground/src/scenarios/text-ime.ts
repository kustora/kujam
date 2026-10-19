/**
 * Scenario dedicated to rich text, multi-level lists, and IME typing tests (BOARD-2403).
 */

import { createBoard, defaultCommands, type Board } from '@kujam/core';
import { defaultElements, defaultTools } from '@kujam/shapes';

import { BoardHarness, createBoardConfigPanel } from '../board-config.js';
import { attachDragAndDropImport, createFileIoControls } from '../file-io.js';
import { h, json, section } from '../dom.js';
import { defineScenario } from '../scenario.js';

function seedTextImeElements(board: Board): void {
  // Title
  board.create({
    type: 'text',
    x: 80,
    y: 30,
    w: 750,
    h: 50,
    props: {
      text: [
        { insert: 'Uji Rich Text, Daftar Bersarang & Pengetikan IME\n', attributes: { bold: true } },
        { insert: 'Model kanonikal ADR-008: delta Quill/Yjs, sanitasi tautan, auto-shrink sticky, dan isolasi komposisi IME.\n' },
      ],
      size: 'l',
      align: 'start',
      widthMode: 'auto',
      color: 'black',
    },
  });

  // ========== 1. FORMATTING & TAUTAN AMAN ==========
  board.create({
    type: 'text',
    x: 80,
    y: 110,
    w: 380,
    h: 220,
    props: {
      text: [
        { insert: '1. Format Teks & Tautan Aman\n', attributes: { bold: true } },
        { insert: 'Teks biasa, kemudian ' },
        { insert: 'teks tebal', attributes: { bold: true } },
        { insert: ', ' },
        { insert: 'teks miring', attributes: { italic: true } },
        { insert: ', dan gabungan ' },
        { insert: 'tebal + miring', attributes: { bold: true, italic: true } },
        { insert: '.\n\nTautan aman: ' },
        { insert: 'Dokumentasi Kujam', attributes: { link: 'https://kujam.dev' } },
        { insert: ' serta ' },
        { insert: 'Kirim Email', attributes: { link: 'mailto:support@kujam.dev' } },
        { insert: '.\nSkema berbahaya (javascript:) otomatis ditolak oleh sanitizer ADR-008.\n' },
      ],
      size: 'm',
      align: 'start',
      widthMode: 'fixed',
      color: 'black',
    },
  });

  // ========== 2. DAFTAR BERSARANG (NESTED LISTS) ==========
  board.create({
    type: 'text',
    x: 480,
    y: 110,
    w: 360,
    h: 220,
    props: {
      text: [
        { insert: '2. Daftar Berbutir & Bernomor\n', attributes: { bold: true } },
        { insert: 'Item butir level 1' },
        { insert: '\n', attributes: { list: 'bullet' } },
        { insert: 'Sub-item butir level 2' },
        { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
        { insert: 'Sub-sub-item butir level 3' },
        { insert: '\n', attributes: { list: 'bullet', indent: 2 } },
        { insert: 'Langkah pertama' },
        { insert: '\n', attributes: { list: 'ordered' } },
        { insert: 'Langkah kedua dengan rincian' },
        { insert: '\n', attributes: { list: 'ordered' } },
        { insert: 'Sub-langkah 2.a' },
        { insert: '\n', attributes: { list: 'ordered', indent: 1 } },
      ],
      size: 'm',
      align: 'start',
      widthMode: 'fixed',
      color: 'black',
    },
  });

  // ========== 3. AUTO-SHRINK STICKY NOTE ==========
  board.create({
    type: 'sticky',
    x: 860,
    y: 110,
    w: 240,
    h: 240,
    props: {
      text: [
        { insert: 'Auto-Shrink Sticky\n', attributes: { bold: true } },
        { insert: 'Ketika teks dalam sticky note semakin panjang, ukuran font otomatis mengecil secara proporsional agar seluruh isi teks tetap berada di dalam batas kartu sticky tanpa overflow!\n\n' },
        { insert: '• Poin evaluasi A\n' },
        { insert: '• Poin evaluasi B\n' },
        { insert: '• Poin evaluasi C\n' },
        { insert: 'Klik ganda untuk menambah teks lebih banyak dan perhatikan perubahan font secara halus.\n' },
      ],
      color: 'yellow',
      authorId: 'editor',
    },
  });

  // ========== 4. KOTAK UJI PENGETIKAN IME (JEPANG, MANDARIN, KOREA) ==========
  board.create({
    type: 'text',
    x: 80,
    y: 380,
    w: 700,
    h: 40,
    props: {
      text: [
        { insert: '3. Area Pengetikan IME (Input Method Editor)\n', attributes: { bold: true } },
        { insert: 'Klik ganda pada kotak teks di bawah untuk mengaktifkan inline editor dan coba ketik dengan IME aktif:\n' },
      ],
      size: 'm',
      align: 'start',
      widthMode: 'auto',
      color: 'blue',
    },
  });

  // Japanese IME
  board.create({
    type: 'text',
    x: 80,
    y: 440,
    w: 360,
    h: 140,
    props: {
      text: [
        { insert: '🇯🇵 Bahasa Jepang (日本語 IME)\n', attributes: { bold: true } },
        { insert: 'Uji komposisi Romaji -> Hiragana -> Kanji:\n' },
        { insert: '「こんにちは、世界！手書きのホワイトボードで共同作業しましょう。」\n' },
        { insert: 'Proteksi compositionstart & compositionend mencegah event terputus sebelum konfirmasi Enter.\n' },
      ],
      size: 'm',
      align: 'start',
      widthMode: 'fixed',
      color: 'black',
    },
  });

  // Simplified Chinese IME
  board.create({
    type: 'text',
    x: 480,
    y: 440,
    w: 360,
    h: 140,
    props: {
      text: [
        { insert: '🇨🇳 Bahasa Mandarin (拼音输入法)\n', attributes: { bold: true } },
        { insert: 'Uji komposisi Pinyin -> Karakter Hanzi:\n' },
        { insert: '“这是一个无DOM依赖的高性能白板协同引擎，支持平滑缩放与矢量渲染。”\n' },
        { insert: 'Kandidat kata IME ditampilkan tanpa glitch pada overlay kanvas.\n' },
      ],
      size: 'm',
      align: 'start',
      widthMode: 'fixed',
      color: 'black',
    },
  });

  // Korean IME & European Accents
  board.create({
    type: 'text',
    x: 860,
    y: 440,
    w: 360,
    h: 140,
    props: {
      text: [
        { insert: '🇰🇷 Bahasa Korea & Aksen Eropa\n', attributes: { bold: true } },
        { insert: 'Hangul: "화이트보드 실시간 협업 시스템"\n' },
        { insert: 'Dead keys & aksen: Café, naïve, façade, résumé, señor, Über.\n' },
        { insert: 'Karakter gabungan diproses dengan benar.\n' },
      ],
      size: 'm',
      align: 'start',
      widthMode: 'fixed',
      color: 'black',
    },
  });

  // ========== 5. BENTUK GEOMETRI DENGAN TEKS TERPUSAT ==========
  board.create({
    type: 'geo',
    x: 80,
    y: 620,
    w: 220,
    h: 140,
    props: {
      geo: 'rounded-rectangle',
      fill: 'semi',
      fillColor: 'green',
      strokeColor: 'green',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'green',
      label: [
        { insert: 'Teks Bentuk Geometri\n', attributes: { bold: true } },
        { insert: 'Terpusat otomatis\n' },
        { insert: 'dengan wrapping rapi\n' },
      ],
    },
  });

  board.create({
    type: 'geo',
    x: 340,
    y: 610,
    w: 160,
    h: 160,
    props: {
      geo: 'diamond',
      fill: 'solid',
      fillColor: 'yellow',
      strokeColor: 'orange',
      strokeWidth: 3,
      dash: 'solid',
      textColor: 'black',
      label: [
        { insert: 'Keputusan?\n', attributes: { bold: true } },
        { insert: 'Klik 2x edit\n' },
      ],
    },
  });

  board.create({
    type: 'geo',
    x: 540,
    y: 610,
    w: 160,
    h: 160,
    props: {
      geo: 'star',
      fill: 'semi',
      fillColor: 'orange',
      strokeColor: 'red',
      strokeWidth: 2,
      dash: 'solid',
      textColor: 'red',
      label: [{ insert: 'Bintang ⭐\n', attributes: { bold: true } }],
    },
  });
}

export default defineScenario({
  id: 'text-ime',
  title: 'Rich Text & Pengetikan IME',
  description: 'Skenario khusus untuk format rich text (tebal, miring, tautan), daftar bertingkat 1-3, dan input IME.',
  order: 3,
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

    seedTextImeElements(board);
    board.camera.setViewport({ width: main.clientWidth || 1200, height: main.clientHeight || 800 });

    const detachDnd = attachDragAndDropImport(main, () => board);

    // Quick inserters for testing
    const insertListBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const cam = board.getCamera();
          board.create({
            type: 'text',
            x: -cam.x + 200,
            y: -cam.y + 200,
            w: 300,
            h: 150,
            props: {
              text: [
                { insert: 'Daftar Tugas Baru:\n', attributes: { bold: true } },
                { insert: 'Tugas level 1' },
                { insert: '\n', attributes: { list: 'bullet' } },
                { insert: 'Sub-tugas level 2' },
                { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
                { insert: 'Sub-sub tugas level 3' },
                { insert: '\n', attributes: { list: 'bullet', indent: 2 } },
              ],
              size: 'm',
              align: 'start',
              widthMode: 'fixed',
              color: 'black',
            },
          });
        },
      },
      '➕ Sisipkan Template Daftar',
    );

    const insertImeSampleBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const cam = board.getCamera();
          board.create({
            type: 'text',
            x: -cam.x + 200,
            y: -cam.y + 200,
            w: 320,
            h: 100,
            props: {
              text: [
                { insert: '日本語の入力テスト：\n「吾輩は猫である。名前はまだ無い。」\n', attributes: { bold: true } },
              ],
              size: 'm',
              align: 'start',
              widthMode: 'auto',
              color: 'purple',
            },
          });
        },
      },
      '➕ Sisipkan Sampel Jepang',
    );

    const insertStickyBtn = h(
      'button',
      {
        type: 'button',
        onclick: () => {
          const cam = board.getCamera();
          board.create({
            type: 'sticky',
            x: -cam.x + 200,
            y: -cam.y + 200,
            w: 200,
            h: 200,
            props: {
              text: [
                { insert: 'Catatan Sticky Baru\n', attributes: { bold: true } },
                { insert: 'Ketik teks di sini...\n' },
              ],
              color: 'pink',
              authorId: null,
            },
          });
        },
      },
      '➕ Sisipkan Sticky Pink',
    );

    const testControls = h(
      'div',
      { class: 'column', style: 'display: flex; flex-direction: column; gap: 6px;' },
      insertListBtn,
      insertImeSampleBtn,
      insertStickyBtn,
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
      section('Sisipkan Template Uji', testControls),
      section('Navigasi & Riwayat', h('div', { class: 'row wrap' }, zoomInBtn, zoomOutBtn, zoomFitBtn, undoBtn, redoBtn)),
      section('File I/O Dokumen', fileIoPanel),
      section('Konfigurasi Papan', configPanel),
    );

    // Debug Panel
    const docPre = h('pre', { style: 'font-size: 11px; max-height: 250px; overflow: auto;' }, json(board.getDocument()));
    const selPre = h('pre', { style: 'font-size: 11px;' }, json(board.selection));

    function updateDebug(): void {
      docPre.textContent = json(board.getDocument());
      selPre.textContent = json(board.selection);
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
