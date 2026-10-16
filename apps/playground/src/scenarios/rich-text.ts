/**
 * Lab rich text (BOARD-008, ADR-008): editor Quill dari prototipe spike, delta kanonik, dan log
 * event input untuk uji IME manual. Sementara memakai kode spike sampai BOARD-1003 selesai.
 */
import 'quill/dist/quill.core.css';
import { mount as mountQuill } from '@kujam/spike-board-008-richtext/src/editors/quill.ts';
import {
  normalizeRichText,
  richTextToPlainText,
  sanitizeLink,
  validateRichText,
  type RichText,
} from '@kujam/spike-board-008-richtext/src/model.ts';
import { h, json, section } from '../dom.js';
import { defineScenario } from '../scenario.js';

const PRESETS: Record<string, { label: string; delta: RichText }> = {
  empty: { label: 'Kosong', delta: [{ insert: '\n' }] },
  formatted: {
    label: 'Format dasar',
    delta: [
      { insert: 'Rapat ' },
      { insert: 'Senin', attributes: { bold: true } },
      { insert: ' jam 10, bahas ' },
      { insert: 'brief', attributes: { italic: true, link: 'https://kustora.id' } },
      { insert: '\n' },
    ],
  },
  lists: {
    label: 'Daftar',
    delta: [
      { insert: 'Agenda\nPembukaan' },
      { insert: '\n', attributes: { list: 'ordered' } },
      { insert: 'Ulasan' },
      { insert: '\n', attributes: { list: 'ordered' } },
      { insert: 'konten minggu ini' },
      { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
      { insert: 'Penutup' },
      { insert: '\n', attributes: { list: 'ordered' } },
    ],
  },
  cjk: { label: 'CJK dan emoji', delta: [{ insert: '会議の予定 · 회의 일정 · 会议安排 👩‍💻\n' }] },
};

const MALICIOUS_HTML = `<p>Halo <b>tebal</b> <span style="color:red;font-size:40px">berwarna</span></p>
<script>alert('xss')</script><img src=x onerror="alert('xss')">
<a href="javascript:alert('xss')">tautan jahat</a> <a href="https://kustora.id">tautan aman</a>
<ul><li>satu</li><li>dua</li></ul><table><tr><td>sel tabel</td></tr></table><h1>judul</h1>`;

const LOG_LIMIT = 200;

/** Perbandingan struktural (urutan kunci objek diabaikan: Quill menulis `attributes` sebelum `insert`). */
function sameDelta(a: readonly unknown[], b: RichText): boolean {
  const key = (op: unknown) => {
    const { insert, attributes } = op as { insert?: unknown; attributes?: Record<string, unknown> };
    const attrs = Object.entries(attributes ?? {}).sort(([x], [y]) => x.localeCompare(y));
    return JSON.stringify([insert, attrs]);
  };
  return a.length === b.length && a.every((op, i) => key(op) === key(b[i]));
}

export default defineScenario({
  id: 'rich-text',
  title: 'Lab rich text',
  description: 'Editor sticky (Quill), delta kanonik, dan log event IME (BOARD-008).',
  order: 10,
  layout: 'lab',
  mount({ main, controls, debug, state }) {
    const host = h('div', { class: 'sticky-editor' });
    const plain = h('pre', { class: 'plain' });
    main.append(
      h(
        'div',
        { class: 'lab' },
        h('h2', {}, 'Sticky'),
        h(
          'p',
          { class: 'muted' },
          'Mod+B tebal · Mod+I miring · Mod+K tautan · ketik "- " atau "1. " untuk daftar.',
        ),
        host,
        h('h2', {}, 'Teks polos (export.text dan a11y)'),
        plain,
      ),
    );

    const quill = mountQuill(host);
    const promptLink = () => {
      const range = quill.getSelection(true);
      if (!range || range.length === 0) {
        window.alert('Pilih teks dulu untuk dijadikan tautan.');
        return;
      }
      const raw = window.prompt(
        'URL tautan (http, https, atau mailto). Kosongkan untuk menghapus:',
        '',
      );
      if (raw === null) return;
      if (raw.trim() === '') {
        quill.format('link', false);
        return;
      }
      const href = sanitizeLink(raw);
      if (!href) window.alert(`Ditolak: ${raw}`);
      else quill.format('link', href);
    };
    quill.keyboard.addBinding({ key: 'k', shortKey: true }, () => {
      promptLink();
      return false;
    });

    // ---------- Panel debug ----------
    const canonicalBadge = h('div', { class: 'status', role: 'status' });
    const normalizedOut = h('pre', {});
    const rawOut = h('pre', {});
    const logList = h('ol', { class: 'event-log', reversed: true });

    const update = () => {
      const raw = quill.getContents().ops as unknown[];
      const normalized = normalizeRichText(raw);
      const valid = validateRichText(normalized);
      const identical = sameDelta(raw, normalized);
      canonicalBadge.className = `status ${identical && valid.ok ? 'ok' : 'warn'}`;
      canonicalBadge.textContent = `${valid.ok ? 'Valid' : 'TIDAK valid'} · ${identical ? 'delta Quill sudah kanonik' : 'normalisasi mengubah delta'}`;
      normalizedOut.textContent = json(normalized);
      rawOut.textContent = json(raw);
      plain.textContent = richTextToPlainText(normalized) || '(kosong)';
    };
    quill.on('text-change', update);

    const log = (type: string, detail: string) => {
      const time = new Date().toISOString().slice(17, 23);
      logList.prepend(h('li', {}, h('code', {}, time), ' ', h('strong', {}, type), ' ', detail));
      while (logList.childElementCount > LOG_LIMIT) logList.lastElementChild?.remove();
    };
    const listeners: [string, EventListener][] = [
      [
        'compositionstart',
        (e) => log('compositionstart', JSON.stringify((e as CompositionEvent).data)),
      ],
      [
        'compositionupdate',
        (e) => log('compositionupdate', JSON.stringify((e as CompositionEvent).data)),
      ],
      [
        'compositionend',
        (e) => log('compositionend', JSON.stringify((e as CompositionEvent).data)),
      ],
      [
        'beforeinput',
        (e) => {
          const ev = e as InputEvent;
          log(
            'beforeinput',
            `${ev.inputType} ${JSON.stringify(ev.data)} isComposing=${ev.isComposing}`,
          );
        },
      ],
      [
        'keydown',
        (e) => {
          const ev = e as KeyboardEvent;
          log(
            'keydown',
            `${JSON.stringify(ev.key)} keyCode=${ev.keyCode} isComposing=${ev.isComposing}`,
          );
        },
      ],
    ];
    for (const [type, fn] of listeners) quill.root.addEventListener(type, fn);

    // ---------- Panel kontrol ----------
    const toggle = (format: 'bold' | 'italic') => () =>
      quill.format(format, !quill.getFormat()[format]);
    const list = (kind: 'bullet' | 'ordered') => () =>
      quill.format('list', quill.getFormat().list === kind ? false : kind);

    const presetSelect = h('select', { 'aria-label': 'Contoh isi' });
    for (const [id, p] of Object.entries(PRESETS))
      presetSelect.append(h('option', { value: id }, p.label));
    const loadPreset = (id: string) => {
      const preset = PRESETS[id] ?? PRESETS.formatted!;
      quill.setContents(preset.delta as never, 'user');
      presetSelect.value = id in PRESETS ? id : 'formatted';
      state.set('preset', presetSelect.value);
    };
    presetSelect.addEventListener('change', () => loadPreset(presetSelect.value));

    const simulatePaste = () => {
      quill.focus();
      const dt = new DataTransfer();
      dt.setData('text/html', MALICIOUS_HTML);
      dt.setData('text/plain', 'cadangan teks polos');
      quill.root.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    };

    controls.append(
      section(
        'Format',
        h(
          'div',
          { class: 'row wrap' },
          h('button', { type: 'button', onclick: toggle('bold') }, h('b', {}, 'B')),
          h('button', { type: 'button', onclick: toggle('italic') }, h('i', {}, 'I')),
          h('button', { type: 'button', onclick: list('bullet') }, '• Daftar'),
          h('button', { type: 'button', onclick: list('ordered') }, '1. Daftar'),
          h('button', { type: 'button', onclick: promptLink }, 'Tautan'),
        ),
      ),
      section('Contoh isi', presetSelect),
      section(
        'Uji tempel',
        h('button', { type: 'button', onclick: simulatePaste }, 'Tempel HTML jahat'),
        h(
          'p',
          { class: 'muted' },
          'Harus: tidak ada alert, tidak ada gambar, tabel, atau warna; tautan javascript: hilang.',
        ),
        h('details', {}, h('summary', {}, 'HTML yang ditempel'), h('pre', {}, MALICIOUS_HTML)),
      ),
      section(
        'Uji IME manual',
        h(
          'ul',
          { class: 'muted checklist' },
          h(
            'li',
            {},
            'Jepang: konversi dengan Spasi, Esc membatalkan komposisi (bukan keluar edit).',
          ),
          h('li', {}, 'Cina Pinyin: angka untuk memilih kandidat tidak memicu shortcut.'),
          h('li', {}, 'Korea: ketik di akhir baris lalu Enter; suku kata tidak ganda.'),
          h('li', {}, 'Lihat urutan event di panel kanan.'),
        ),
        h('p', { class: 'muted' }, 'Daftar lengkap: docs/adr/ADR-008-rich-text-model.md.'),
      ),
    );
    debug.append(
      section('Status', canonicalBadge),
      section('Delta kanonik (disimpan)', normalizedOut),
      section('Delta mentah Quill', rawOut),
      section(
        'Log event input',
        h(
          'button',
          { type: 'button', class: 'ghost', onclick: () => logList.replaceChildren() },
          'Bersihkan',
        ),
        logList,
      ),
    );

    loadPreset(state.get('preset') ?? 'formatted');
    update();
    quill.focus();

    return () => {
      for (const [type, fn] of listeners) quill.root.removeEventListener(type, fn);
      quill.off('text-change', update);
    };
  },
});
