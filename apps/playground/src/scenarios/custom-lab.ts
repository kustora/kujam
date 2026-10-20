/**
 * Custom element lab (BOARD-2411): the contact card example (BOARD-1207) with a fake API whose
 * answers are controlled from the panel, to exercise the `resolve` runtime (BOARD-604) and the
 * renderer's data states (BOARD-1201 to BOARD-1206).
 *
 * - Resolver controls, globally or per contact: sync (warm cache) or async with latency, and the
 *   outcome (`ok`, `forbidden`, `not-found`, `error`, exception).
 * - `invalidate` per contact and globally, "change data" per contact, and an automatic random
 *   change every N ms to test invalidations in a row.
 * - Debug panel: the selected element's data state, its contextual actions, and a log of the
 *   `action`, `data`, and `error` events.
 *
 * Planned once their features exist: an LOD threshold slider with the render mode per element
 * (BOARD-1204) and a `replaceElements` button (BOARD-606, BOARD-303).
 *
 * In test mode the fake API is exposed as `window.__contacts`.
 */

import { createBoard, defaultCommands, type ElementAction } from '@kujam/core';
import {
  CONTACT_CARD_SIZE,
  contactCardPlugin,
  createFakeContactApi,
  type FakeContactApi,
  type FakeOutcome,
} from '@kujam/example-contact-card';
import { mountRenderer } from '@kujam/renderer';
import { attachTextEditor, defaultElements, defaultTools } from '@kujam/shapes';
import { mountDefaultUi } from '@kujam/ui';
import { h, json, section } from '../dom.js';
import { defineScenario } from '../scenario.js';

declare global {
  interface Window {
    /** Fake contact API of the custom element lab, in test mode. */
    __contacts?: FakeContactApi;
  }
}

const OUTCOMES: readonly { value: FakeOutcome; label: string }[] = [
  { value: 'ok', label: 'OK' },
  { value: 'forbidden', label: 'forbidden' },
  { value: 'not-found', label: 'not-found' },
  { value: 'error', label: 'error' },
  { value: 'throw', label: 'exception' },
];

const MAX_LOG = 60;

export default defineScenario({
  id: 'custom-lab',
  title: 'Lab elemen kustom',
  description:
    'Kartu kontak dengan resolver palsu: latensi, sync/async, forbidden, not-found, error, invalidate, dan log aksi.',
  order: 30,
  layout: 'board',
  mount({ main, controls, debug, expose }) {
    const testMode = new URL(location.href).searchParams.get('test') === '1';
    const api = createFakeContactApi();
    const board = createBoard({
      locale: 'id',
      plugins: [defaultCommands, defaultElements, defaultTools, contactCardPlugin],
      resolvers: { contact: (id) => api.resolve(id) },
    });
    board.setTool('select');
    expose(board);
    if (testMode) window.__contacts = api;

    const view = mountRenderer(board, main, { background: 'dots' });
    const textEditor = attachTextEditor(view);
    const ui = mountDefaultUi({ board, container: main });

    // Data edited "elsewhere" reaches only the cards that show it.
    const offApi = api.onChange((id) => board.invalidate('contact', id));

    // ---------- Seed: one card per contact, plus an unknown ID ----------
    const { w, h: ch } = CONTACT_CARD_SIZE;
    let added = 0;
    function addCard(contactId: string): void {
      const col = added % 3;
      const row = Math.floor(added / 3);
      added++;
      board.create({
        type: 'contact-card',
        x: 80 + col * (w + 32),
        y: 80 + row * (ch + 32),
        w,
        h: ch,
        props: { contactId },
      });
    }
    for (const contact of api.contacts()) addCard(contact.id);
    addCard('c-tak-dikenal');
    board.history.clear();

    // ---------- Event log ----------
    const logList = h('ol', { class: 'event-log' });
    const counters = { data: 0, action: 0, error: 0 };
    const counterLine = h('p', { class: 'muted' });
    function log(kind: string, detail: unknown): void {
      counters[kind as keyof typeof counters]++;
      const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
      logList.prepend(h('li', {}, `${time} ${kind} ${json(detail).replace(/\s+/g, ' ')}`));
      while (logList.childElementCount > MAX_LOG) logList.lastElementChild?.remove();
      renderCounters();
    }
    function renderCounters(): void {
      counterLine.textContent = `Panggilan API: ${api.calls} · event data: ${counters.data} · aksi: ${counters.action} · error: ${counters.error}`;
    }
    const offs = [
      board.on('data', (e) => {
        log('data', e.ids);
        renderSelection();
      }),
      board.on('action', (e) => log('action', e)),
      board.on('error', (e) => log('error', { code: e.code, message: e.message })),
      board.on('selection', () => renderSelection()),
      board.on('change', () => renderSelection()),
    ];

    // ---------- Global resolver controls ----------
    const modeSelect = h(
      'select',
      {
        'aria-label': 'Mode resolver',
        onchange: () => api.setBehavior({ mode: modeSelect.value as 'sync' | 'async' }),
      },
      h('option', { value: 'async', selected: true }, 'Async (dengan latensi)'),
      h('option', { value: 'sync' }, 'Sync (dari cache)'),
    );
    const latencyLabel = h('span', { class: 'muted' }, `${api.globalBehavior.latencyMs} ms`);
    const latency = h('input', {
      type: 'range',
      min: '0',
      max: '3000',
      step: '50',
      value: String(api.globalBehavior.latencyMs),
      'aria-label': 'Latensi global',
      oninput: () => {
        api.setBehavior({ latencyMs: Number(latency.value) });
        latencyLabel.textContent = `${latency.value} ms`;
      },
    });
    const outcomeSelect = h(
      'select',
      {
        'aria-label': 'Hasil global',
        onchange: () => api.setBehavior({ outcome: outcomeSelect.value as FakeOutcome }),
      },
      ...OUTCOMES.map((o) => h('option', { value: o.value }, o.label)),
    );

    // ---------- Per-contact controls ----------
    // One compact block per contact: the panel is narrow.
    const perContact = h('div', { style: 'display: grid; gap: 10px' });
    for (const contact of [...api.contacts(), { id: 'c-tak-dikenal', name: '(ID tak dikenal)' }]) {
      const select = h(
        'select',
        {
          'aria-label': `Hasil untuk ${contact.name}`,
          style: 'flex: 1; min-width: 0',
          onchange: () =>
            api.setBehavior(
              select.value === '' ? null : { outcome: select.value as FakeOutcome },
              contact.id,
            ),
        },
        h('option', { value: '' }, 'ikut global'),
        ...OUTCOMES.map((o) => h('option', { value: o.value }, o.label)),
      );
      const small = 'padding: 2px 8px; font-size: 12px';
      perContact.append(
        h(
          'div',
          { style: 'display: grid; gap: 4px' },
          h('strong', { style: 'font-size: 12px' }, contact.name),
          h(
            'div',
            { class: 'row' },
            select,
            h(
              'button',
              {
                type: 'button',
                style: small,
                title: 'Buang cache dan muat ulang kartu kontak ini',
                onclick: () => board.invalidate('contact', contact.id),
              },
              'Invalidate',
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'ghost',
                style: small,
                title: 'Ubah data kontak di API palsu (memicu invalidate)',
                onclick: () =>
                  api.update(contact.id, {
                    role: `Diubah ${new Date().toLocaleTimeString('id-ID')}`,
                  }),
              },
              'Ubah',
            ),
          ),
        ),
      );
    }

    // ---------- Random changes every N ms ----------
    let timer: ReturnType<typeof setInterval> | null = null;
    const intervalInput = h('input', {
      type: 'number',
      min: '50',
      step: '50',
      value: '500',
      'aria-label': 'Interval ubah data acak (ms)',
      style: 'width: 80px',
    });
    const autoToggle = h('input', {
      type: 'checkbox',
      'aria-label': 'Ubah data acak',
      onchange: () => {
        if (timer) clearInterval(timer);
        timer = autoToggle.checked
          ? setInterval(() => api.randomize(), Math.max(50, Number(intervalInput.value) || 500))
          : null;
      },
    });

    controls.append(
      section(
        'Resolver global',
        h('label', { class: 'row' }, 'Mode ', modeSelect),
        h('label', { class: 'row' }, 'Latensi ', latency, latencyLabel),
        h('label', { class: 'row' }, 'Hasil ', outcomeSelect),
        h(
          'p',
          { class: 'muted' },
          'Perubahan berlaku untuk permintaan berikutnya: tekan Invalidate untuk memuat ulang.',
        ),
      ),
      section('Per kontak', perContact),
      section(
        'Invalidasi',
        h(
          'div',
          { class: 'row wrap' },
          h(
            'button',
            { type: 'button', onclick: () => board.invalidate('contact') },
            'Invalidate semua',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'ghost',
              onclick: () => {
                const contacts = api.contacts();
                addCard(contacts[Math.floor(Math.random() * contacts.length)]!.id);
              },
            },
            'Tambah kartu',
          ),
        ),
        h('label', { class: 'row' }, autoToggle, ' Ubah data acak tiap ', intervalInput, ' ms'),
        counterLine,
      ),
      section(
        'Menyusul',
        h(
          'p',
          { class: 'muted' },
          'Slider ambang LOD dan mode render per elemen (BOARD-1204), serta tombol replaceElements (BOARD-606).',
        ),
      ),
    );

    // ---------- Debug: selection data, actions, log ----------
    const dataBox = h('pre', {}, '(tidak ada seleksi)');
    const actionsBox = h('div', { class: 'row wrap' });
    function renderSelection(): void {
      const id = board.selection[0];
      if (!id) {
        dataBox.textContent = '(tidak ada seleksi)';
        actionsBox.replaceChildren(
          h('span', { class: 'muted' }, 'Pilih elemen untuk melihat aksinya.'),
        );
        return;
      }
      const el = board.getElement(id);
      dataBox.textContent = json({
        id,
        type: el?.type,
        props: el?.props,
        data: board.getElementData(id, { load: false }),
      });
      const actions = board.getActions();
      actionsBox.replaceChildren(
        ...(actions.length > 0
          ? actions.map((action: ElementAction) =>
              h(
                'button',
                {
                  type: 'button',
                  disabled: action.isEnabled ? !action.isEnabled() : false,
                  onclick: () => action.run(),
                },
                action.label,
              ),
            )
          : [h('span', { class: 'muted' }, 'Tidak ada aksi.')]),
      );
    }
    renderSelection();
    renderCounters();
    debug.append(
      section('Data elemen terpilih', dataBox),
      section('Aksi kontekstual', actionsBox),
      section('Log event', logList),
    );

    return () => {
      if (timer) clearInterval(timer);
      offApi();
      for (const off of offs) off();
      if (testMode) delete window.__contacts;
      ui.unmount();
      textEditor.detach();
      view.unmount();
      board.dispose();
    };
  },
});
