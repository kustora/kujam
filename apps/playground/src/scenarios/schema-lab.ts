/**
 * Lab skema props (BOARD-203, ADR-007): tulis JSON props, lihat hasil `validate` dan path issue.
 */
import {
  array,
  boolean,
  enumOf,
  literal,
  nullable,
  number,
  optional,
  schema,
  string,
  validate,
  type Schema,
} from '@kujam/core';
import { richTextSchema } from '@kujam/spike-board-008-richtext/src/model.ts';
import { h, json, section } from '../dom.js';
import { defineScenario } from '../scenario.js';

interface Preset {
  label: string;
  schema: Schema<unknown>;
  source: string;
  type: string;
  valid: unknown;
  invalid: unknown;
}

const PRESETS: Record<string, Preset> = {
  sticky: {
    label: 'Props sticky',
    schema: schema({
      kind: literal('sticky'),
      text: string({ maxLength: 10_000 }),
      color: enumOf(['yellow', 'orange', 'green', 'blue', 'violet', 'pink']),
      fontSize: number({ min: 8, max: 200 }),
      align: optional(enumOf(['left', 'center', 'right'])),
      link: nullable(string()),
      locked: boolean(),
      tags: array(string(), { maxLength: 50 }),
    }),
    source: `schema({
  kind: literal('sticky'),
  text: string({ maxLength: 10_000 }),
  color: enumOf(['yellow', 'orange', 'green', 'blue', 'violet', 'pink']),
  fontSize: number({ min: 8, max: 200 }),
  align: optional(enumOf(['left', 'center', 'right'])),
  link: nullable(string()),
  locked: boolean(),
  tags: array(string(), { maxLength: 50 }),
})`,
    type: `{
  kind: 'sticky';
  text: string;
  color: 'yellow' | 'orange' | 'green' | 'blue' | 'violet' | 'pink';
  fontSize: number;
  align?: 'left' | 'center' | 'right';
  link: string | null;
  locked: boolean;
  tags: string[];
}`,
    valid: {
      kind: 'sticky',
      text: 'Ide kampanye',
      color: 'yellow',
      fontSize: 16,
      link: null,
      locked: false,
      tags: ['q4'],
    },
    invalid: {
      kind: 'note',
      text: 42,
      color: 'red',
      fontSize: 1000,
      link: null,
      tags: ['ok', 7],
      extra: true,
    },
  },
  card: {
    label: 'Props kartu kustom',
    schema: schema({ refId: string({ minLength: 1 }), size: enumOf(['s', 'm', 'l']) }),
    source: `schema({ refId: string({ minLength: 1 }), size: enumOf(['s', 'm', 'l']) })`,
    type: `{ refId: string; size: 's' | 'm' | 'l' }`,
    valid: { refId: 'ref-123', size: 'm' },
    invalid: { refId: '', size: 'xl' },
  },
  stroke: {
    label: 'Props coretan',
    schema: schema({
      points: array(array(number()), { maxLength: 5000 }),
      color: string(),
      width: number({ min: 0.5, max: 64 }),
      brush: optional(string()),
    }),
    source: `schema({
  points: array(array(number()), { maxLength: 5000 }),
  color: string(),
  width: number({ min: 0.5, max: 64 }),
  brush: optional(string()),
})`,
    type: `{ points: number[][]; color: string; width: number; brush?: string }`,
    valid: {
      points: [
        [0, 0, 0.5],
        [4, 2, 0.6],
      ],
      color: '#222',
      width: 3,
    },
    invalid: {
      points: [
        [0, 0],
        [1, 'x'],
      ],
      color: '#222',
      width: 0,
    },
  },
  richText: {
    label: 'Rich text (ADR-008)',
    schema: richTextSchema as Schema<unknown>,
    source: `array(object({
  insert: string({ minLength: 1, maxLength: 20_000 }),
  attributes: optional(object({
    bold: optional(literal(true)),
    italic: optional(literal(true)),
    link: optional(string({ maxLength: 2048 })),
    list: optional(enumOf(['bullet', 'ordered'])),
    indent: optional(number({ int: true, min: 1, max: 3 })),
  })),
}), { maxLength: 20_000 })`,
    type: `Array<{ insert: string; attributes?: { bold?: true; italic?: true; link?: string; list?: 'bullet' | 'ordered'; indent?: number } }>`,
    valid: [{ insert: 'Halo ' }, { insert: 'dunia', attributes: { bold: true } }, { insert: '\n' }],
    invalid: [
      { insert: '' },
      { insert: 'x', attributes: { bold: false, color: 'red' } },
      { insert: { image: 'a.png' } },
    ],
  },
};

export default defineScenario({
  id: 'schema-lab',
  title: 'Lab skema props',
  description: 'Validasi JSON props dengan mini-lib skema @kujam/core (BOARD-203).',
  order: 20,
  layout: 'lab',
  mount({ main, controls, debug, state }) {
    let presetId = state.get('schema') ?? 'sticky';
    if (!(presetId in PRESETS)) presetId = 'sticky';

    const select = h('select', { 'aria-label': 'Skema' });
    for (const [id, p] of Object.entries(PRESETS))
      select.append(h('option', { value: id }, p.label));
    select.value = presetId;

    const source = h('pre', {});
    const typeOut = h('pre', {});
    const input = h('textarea', {
      class: 'code-input',
      spellcheck: false,
      rows: 16,
      'aria-label': 'JSON props',
    });
    const status = h('div', { class: 'status', role: 'status' });
    const issuesBody = h('tbody', {});
    const issuesTable = h(
      'table',
      { class: 'issues' },
      h('thead', {}, h('tr', {}, h('th', {}, 'path'), h('th', {}, 'code'), h('th', {}, 'message'))),
      issuesBody,
    );
    const resultOut = h('pre', {});

    const run = () => {
      const preset = PRESETS[presetId]!;
      issuesBody.replaceChildren();
      let value: unknown;
      try {
        value = JSON.parse(input.value);
      } catch (err) {
        status.className = 'status error';
        status.textContent = `JSON tidak valid: ${(err as Error).message}`;
        resultOut.textContent = '';
        return;
      }
      const t0 = performance.now();
      const result = validate(preset.schema, value);
      const ms = (performance.now() - t0).toFixed(3);
      resultOut.textContent = json(result);
      if (result.ok) {
        status.className = 'status ok';
        status.textContent = `Valid · ${ms} ms · value === input: ${result.value === value}`;
      } else {
        status.className = 'status error';
        status.textContent = `${result.issues.length} issue · ${ms} ms`;
        for (const issue of result.issues) {
          issuesBody.append(
            h(
              'tr',
              {},
              h('td', {}, h('code', {}, JSON.stringify(issue.path))),
              h('td', {}, issue.code),
              h('td', {}, issue.message),
            ),
          );
        }
      }
      state.set('input', input.value.length < 1500 ? input.value : null);
    };

    const load = (kind: 'valid' | 'invalid') => {
      input.value = json(PRESETS[presetId]![kind]);
      run();
    };
    const showPreset = () => {
      const preset = PRESETS[presetId]!;
      source.textContent = preset.source;
      typeOut.textContent = `Infer<typeof props> =\n${preset.type}`;
    };

    select.addEventListener('change', () => {
      presetId = select.value;
      state.set('schema', presetId);
      showPreset();
      load('valid');
    });
    input.addEventListener('input', run);

    controls.append(
      section('Skema', select, source),
      section(
        'Contoh data',
        h(
          'div',
          { class: 'row' },
          h('button', { type: 'button', onclick: () => load('valid') }, 'Valid'),
          h('button', { type: 'button', onclick: () => load('invalid') }, 'Tidak valid'),
        ),
        h(
          'p',
          { class: 'muted' },
          'NaN dan Infinity tidak bisa ditulis di JSON; uji itu ada di tes unit.',
        ),
      ),
    );
    main.append(h('div', { class: 'lab' }, h('h2', {}, 'JSON props'), input, status, issuesTable));
    debug.append(section('Tipe hasil inferensi', typeOut), section('Hasil validate()', resultOut));

    showPreset();
    const saved = state.get('input');
    if (saved) {
      input.value = saved;
      run();
    } else load('valid');
  },
});
