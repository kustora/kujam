import { createBoard } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { DEFAULT_ELEMENT_TYPES, DEFAULT_TOOL_IDS } from '@kujam/shapes';
import { h, json, section } from '../dom.js';
import { defineScenario } from '../scenario.js';

export default defineScenario({
  id: 'empty',
  title: 'Papan kosong',
  description: 'Papan baru dengan renderer tiga lapisan dan inspector dokumen.',
  order: 0,
  layout: 'board',
  mount({ main, controls, debug }) {
    const board = createBoard({ locale: 'id' });
    const view = mountRenderer(board, main);

    controls.append(
      section(
        'Isi papan',
        h(
          'p',
          { class: 'muted' },
          `Elemen bawaan terdaftar: ${DEFAULT_ELEMENT_TYPES.length} · Tool: ${DEFAULT_TOOL_IDS.length}`,
        ),
        h('p', { class: 'muted' }, 'Kontrol konfigurasi papan menyusul di BOARD-2402.'),
      ),
    );
    debug.append(
      section('Dokumen', h('pre', {}, json(board.getDocument()))),
      section('Kamera', h('pre', {}, json(board.getCamera()))),
    );

    return () => {
      view.unmount();
      board.dispose();
    };
  },
});
