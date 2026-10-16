import {
  createBoard,
  createElementRegistry,
  PluginError,
  validate,
  type AnyElementDefinition,
  type ElementCanvasContext,
  type ElementContext,
  type ElementRecord,
} from '@kujam/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ELEMENT_TYPES,
  defaultElements,
  defaultTools,
  drawElement,
  EMPTY_RICH_TEXT,
  GEO_KINDS,
  geoElement,
  geoGeometry,
  richTextSchema,
  richTextToPlainText,
  stickyElement,
  textElement,
  type RichText,
} from './index.js';
import { a11yLabel } from './i18n.js';

function element<P>(type: string, props: P, w = 200, h = 100): ElementRecord<P> {
  return {
    id: 'e1',
    kind: 'element',
    type,
    pageId: 'p1',
    parentId: null,
    index: 'a0',
    x: 0,
    y: 0,
    rotation: 0,
    w,
    h,
    locked: false,
    opacity: 1,
    props,
    meta: {},
  };
}

function withDefaults<P>(def: { type: string; defaults?: Partial<P> }, props: Partial<P> = {}) {
  return element(def.type, { ...def.defaults, ...props } as P);
}

/** Konteks Canvas palsu yang mencatat setiap panggilan dan penulisan properti. */
function recorder(): { g: ElementCanvasContext; calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const g = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length });
      return (...args: unknown[]) => calls.push(`${key}(${args.join(',')})`);
    },
    set(target, key: string, value) {
      target[key] = value;
      calls.push(`${key}=${Array.isArray(value) ? `[${value}]` : value}`);
      return true;
    },
  }) as unknown as ElementCanvasContext;
  return { g, calls };
}

const lod = { zoom: 1, compact: false };
const ctx = (locale: string): ElementContext => ({ locale, emit: () => {} });
const rich = (text: string): RichText => [{ insert: `${text}\n` }];

describe('defaultElements dan defaultTools', () => {
  it('merupakan plugin biasa yang dipasang lewat createBoard({ plugins }) (BOARD-602)', () => {
    expect(defaultElements.id).toBe('default-elements');
    expect(defaultTools.id).toBe('default-tools');
    expect(Object.isFrozen(defaultElements)).toBe(true);
    expect(Object.isFrozen(defaultTools)).toBe(true);

    const board = createBoard({ plugins: [defaultElements, defaultTools] });
    expect(board.plugins.list().map((p) => p.id)).toEqual(['default-elements', 'default-tools']);
    expect(board.elements.list().map((d) => d.type)).toEqual([...DEFAULT_ELEMENT_TYPES]);
    expect(board.plugins.has('default-elements')).toBe(true);
    expect(board.plugins.has('default-tools')).toBe(true);

    expect(() => createBoard({ plugins: [defaultElements, defaultElements] })).toThrow(PluginError);
    board.dispose();
  });

  it('urutan dan tipe sama dengan DEFAULT_ELEMENT_TYPES', () => {
    expect(defaultElements.elements.map((d) => d.type)).toEqual([...DEFAULT_ELEMENT_TYPES]);
  });

  it('semua bisa didaftarkan ke registri lewat API publik', () => {
    const registry = createElementRegistry(defaultElements);
    expect(registry.list().map((d) => d.type)).toEqual([...DEFAULT_ELEMENT_TYPES]);
    expect(() => registry.register(stickyElement as AnyElementDefinition)).toThrowError(
      /sudah terdaftar/,
    );
  });

  it.each(defaultElements.elements.map((d) => [d.type, d] as const))(
    '%s: defaults lengkap dan lolos skema props',
    (_type, def) => {
      expect(validate(def.props, def.defaults)).toMatchObject({ ok: true });
      expect(def.version).toBe(1);
      expect(def.render?.canvas).toBeTypeOf('function');
      expect(def.a11y).toBeTypeOf('function');
      expect(def.export?.text).toBeTypeOf('function');
      expect(def.geometry).toBeTypeOf('function');
    },
  );
});

describe('rich text', () => {
  it('skema menerima bentuk ADR-008 dan menolak HTML atau atribut asing', () => {
    const doc: RichText = [
      { insert: 'Rencana\nide ' },
      { insert: 'satu', attributes: { bold: true } },
      { insert: '\n', attributes: { list: 'bullet', indent: 1 } },
    ];
    expect(validate(richTextSchema, doc).ok).toBe(true);
    expect(validate(richTextSchema, EMPTY_RICH_TEXT).ok).toBe(true);
    expect(validate(richTextSchema, '<b>x</b>').ok).toBe(false);
    expect(validate(richTextSchema, [{ insert: 'x', attributes: { color: 'red' } }]).ok).toBe(
      false,
    );
    expect(validate(richTextSchema, [{ insert: '' }]).ok).toBe(false);
  });

  it('teks polos membuang \\n penutup', () => {
    expect(richTextToPlainText(EMPTY_RICH_TEXT)).toBe('');
    expect(richTextToPlainText([{ insert: 'a' }, { insert: 'b\nc\n' }])).toBe('ab\nc');
    expect(richTextToPlainText([{ insert: 'tanpa penutup' }])).toBe('tanpa penutup');
    expect(Object.isFrozen(EMPTY_RICH_TEXT)).toBe(true);
  });

  it('label a11y dipotong dan dirapikan', () => {
    expect(a11yLabel('Teks', '  ')).toBe('Teks');
    expect(a11yLabel('Teks', 'a\n  b')).toBe('Teks: a b');
    const long = a11yLabel('Teks', 'x'.repeat(300));
    expect(long).toHaveLength('Teks: '.length + 200);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('sticky', () => {
  const el = withDefaults(stickyElement, { text: rich('Ide rapat') });

  it('props, geometri, dan ekspor', () => {
    expect(stickyElement.resize).toBe('fixed-ratio');
    expect(stickyElement.geometry?.(el)).toEqual({ kind: 'rect', x: 0, y: 0, w: 200, h: 100 });
    expect(stickyElement.export?.text?.(el, undefined)).toBe('Ide rapat');
    expect(validate(stickyElement.props, { ...el.props, color: 'black' }).ok).toBe(false);
  });

  it('a11y dwibahasa memuat warna dan isi', () => {
    expect(stickyElement.a11y?.(el, undefined, ctx('id'))).toEqual({
      role: 'note',
      label: 'Sticky kuning: Ide rapat',
    });
    expect(stickyElement.a11y?.(el, undefined, ctx('en-US')).label).toBe(
      'Yellow sticky: Ide rapat',
    );
  });

  it('render canvas menggambar latar dan teks', () => {
    const { g, calls } = recorder();
    stickyElement.render?.canvas?.(g, el, undefined, lod);
    expect(calls).toContain('fill()');
    expect(calls).toContain('fillStyle=#fff3a3');
    expect(calls).toContain('fillText(Ide rapat,16,16,168)');
  });

  it('teks kosong tidak digambar', () => {
    const { g, calls } = recorder();
    stickyElement.render?.canvas?.(g, withDefaults(stickyElement), undefined, lod);
    expect(calls.some((c) => c.startsWith('fillText'))).toBe(false);
  });
});

describe('draw', () => {
  const points = [
    [0, 0, 0.5],
    [10, 5],
    [20, 0, 1],
  ];
  const el = withDefaults(drawElement, { points });

  it('geometri polyline dengan tebal garis', () => {
    expect(drawElement.geometry?.(el)).toEqual({
      kind: 'polyline',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 20, y: 0 },
      ],
      width: 4,
    });
    expect(drawElement.geometry?.(withDefaults(drawElement, { points: [[]] }))).toMatchObject({
      points: [{ x: 0, y: 0 }],
    });
  });

  it('skema membatasi titik', () => {
    expect(validate(drawElement.props, { ...el.props, points: [[1, 2, 3, 4]] }).ok).toBe(false);
    expect(validate(drawElement.props, { ...el.props, thickness: 0 }).ok).toBe(false);
  });

  it('render canvas: garis, titik tunggal, kosong, dan stabilo', () => {
    let { g, calls } = recorder();
    drawElement.render?.canvas?.(g, el, undefined, lod);
    expect(calls).toEqual(expect.arrayContaining(['moveTo(0,0)', 'lineTo(20,0)', 'stroke()']));
    expect(calls).not.toContain('globalCompositeOperation=multiply');

    ({ g, calls } = recorder());
    drawElement.render?.canvas?.(
      g,
      withDefaults(drawElement, { points: [[3, 4]], brush: 'highlighter' }),
      undefined,
      lod,
    );
    expect(calls).toEqual(
      expect.arrayContaining(['moveTo(3,4)', 'lineTo(3,4)', 'globalCompositeOperation=multiply']),
    );

    ({ g, calls } = recorder());
    drawElement.render?.canvas?.(g, withDefaults(drawElement, { points: [[]] }), undefined, lod);
    expect(calls).toContain('lineTo(0,0)');

    ({ g, calls } = recorder());
    drawElement.render?.canvas?.(g, withDefaults(drawElement), undefined, lod);
    expect(calls).toEqual([]);
  });

  it('a11y dan ekspor', () => {
    expect(drawElement.a11y?.(el, undefined, ctx('id'))).toEqual({ role: 'img', label: 'Coretan' });
    expect(drawElement.a11y?.(el, undefined, ctx('en')).label).toBe('Drawing');
    expect(drawElement.export?.text?.(el, undefined)).toBe('');
  });
});

describe('text', () => {
  const el = withDefaults(textElement, { text: rich('Halo\ndunia'), align: 'center' });

  it('resize hanya mengubah lebar', () => {
    const resize = textElement.resize;
    expect(typeof resize).toBe('function');
    if (typeof resize === 'function')
      expect(resize(el, { w: 300, h: 999 })).toEqual({ w: 300, h: 100 });
  });

  it('render canvas per baris dengan perataan', () => {
    const { g, calls } = recorder();
    textElement.render?.canvas?.(g, el, undefined, lod);
    expect(calls).toEqual(
      expect.arrayContaining([
        'textAlign=center',
        'font=24px sans-serif',
        'fillText(Halo,100,0,200)',
        `fillText(dunia,100,${24 * 1.3},200)`,
      ]),
    );
    const end = recorder();
    textElement.render?.canvas?.(
      end.g,
      { ...el, props: { ...el.props, align: 'end' } },
      undefined,
      lod,
    );
    expect(end.calls).toContain('fillText(Halo,200,0,200)');
  });

  it('a11y, ekspor, dan geometri', () => {
    expect(textElement.a11y?.(el, undefined, ctx('id'))).toEqual({
      role: 'group',
      label: 'Teks: Halo dunia',
    });
    expect(textElement.a11y?.(el, undefined, ctx('en')).label).toBe('Text: Halo dunia');
    expect(textElement.export?.text?.(el, undefined)).toBe('Halo\ndunia');
    expect(textElement.geometry?.(el)).toMatchObject({ kind: 'rect', w: 200, h: 100 });
  });
});

describe('geo', () => {
  it.each(GEO_KINDS.map((k) => [k]))('%s: geometri di dalam kotak elemen', (kind) => {
    const geometry = geoGeometry(kind, 100, 50);
    if (geometry.kind === 'polygon') {
      expect(geometry.points.length).toBeGreaterThanOrEqual(3);
      for (const p of geometry.points) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.x).toBeLessThanOrEqual(100 + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.y).toBeLessThanOrEqual(50 + 1e-9);
      }
    } else {
      expect(geometry).toMatchObject({ x: 0, y: 0, w: 100, h: 50 });
    }
  });

  it('geometri mengikuti props', () => {
    const el = withDefaults(geoElement, { geo: 'ellipse' });
    expect(geoElement.geometry?.(el)).toMatchObject({ kind: 'ellipse' });
  });

  it('render canvas: isi, garis putus-putus, dan label', () => {
    const { g, calls } = recorder();
    const el = withDefaults(geoElement, {
      geo: 'diamond',
      fill: 'semi',
      fillColor: 'blue',
      dash: 'dashed',
      label: rich('Mulai'),
    });
    geoElement.render?.canvas?.(g, el, undefined, lod);
    expect(calls).toEqual(
      expect.arrayContaining([
        'moveTo(100,0)',
        'closePath()',
        'fillStyle=#1971c2',
        'globalAlpha=0.5',
        'setLineDash(8,8)',
        'stroke()',
        'setLineDash()',
        'fillText(Mulai,100,37,200)',
      ]),
    );
  });

  it('render canvas: kotak bulat, elips, isi solid, tanpa garis', () => {
    let { g, calls } = recorder();
    geoElement.render?.canvas?.(
      g,
      withDefaults(geoElement, { geo: 'rounded-rectangle', fill: 'solid', strokeWidth: 0 }),
      undefined,
      lod,
    );
    expect(calls).toContain('quadraticCurveTo(200,0,200,15)');
    expect(calls).toContain('fill()');
    expect(calls).not.toContain('stroke()');
    expect(calls).not.toContain('globalAlpha=0.5');

    ({ g, calls } = recorder());
    geoElement.render?.canvas?.(g, withDefaults(geoElement, { geo: 'ellipse' }), undefined, lod);
    expect(calls).toContain(`ellipse(100,50,100,50,0,0,${Math.PI * 2})`);
    expect(calls).not.toContain('fill()');

    ({ g, calls } = recorder());
    geoElement.render?.canvas?.(g, withDefaults(geoElement), undefined, lod);
    expect(calls).toContain('rect(0,0,200,100)');
  });

  it('a11y dan ekspor', () => {
    const el = withDefaults(geoElement, { geo: 'star', label: rich('Target') });
    expect(geoElement.a11y?.(el, undefined, ctx('id'))).toEqual({
      role: 'img',
      label: 'Bintang: Target',
    });
    expect(geoElement.a11y?.(el, undefined, ctx('en')).label).toBe('Star: Target');
    expect(geoElement.export?.text?.(el, undefined)).toBe('Target');
  });
});
