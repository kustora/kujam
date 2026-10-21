import { describe, expect, it } from 'vitest';
import {
  createElementRegistry,
  defineElement,
  ElementDefinitionError,
  type AnyElementDefinition,
} from './elements.js';
import { ellipse, polygon, polyline, rect } from '../geometry/geometry.js';
import { array, enumOf, number, optional, schema, string } from '../document/schema.js';
import type { ElementRecord } from '../types.js';

const cardProps = schema({
  refId: string({ minLength: 1 }),
  size: enumOf(['s', 'm', 'l']),
  note: optional(string()),
});

function card(overrides: Record<string, unknown> = {}): AnyElementDefinition {
  return defineElement({
    type: 'contact-card',
    version: 1,
    props: cardProps,
    defaults: { size: 'm' },
    ...overrides,
  } as AnyElementDefinition);
}

function element<P>(props: P, w = 100, h = 50): ElementRecord<P> {
  return {
    id: 'e1',
    kind: 'element',
    type: 'contact-card',
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

function definitionErrors(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ElementDefinitionError);
    expect((error as ElementDefinitionError).code).toBe('invalid-definition');
    return (error as ElementDefinitionError).errors;
  }
  throw new Error('diharapkan melempar ElementDefinitionError');
}

describe('defineElement', () => {
  it('mengembalikan definisi yang sama dalam keadaan beku', () => {
    const input = {
      type: 'contact-card',
      version: 2,
      props: cardProps,
      defaults: { size: 's' as const },
      geometry: (el: ElementRecord<{ refId: string }>) => rect(el.w, el.h),
      resize: 'fixed-ratio' as const,
      migrate: { 0: (p: Record<string, unknown>) => ({ ...p, size: 'm' }), 1: (p: object) => p },
      render: { canvas: () => {} },
      export: { text: (el: ElementRecord<{ refId: string }>) => el.props.refId },
      lod: { compactBelowZoom: 0.4 },
    };
    const def = defineElement(input);
    expect(def).toBe(input);
    expect(Object.isFrozen(def)).toBe(true);
    expect(def.geometry?.(element({ refId: 'k', size: 'm' }))).toEqual(rect(100, 50));
    expect(def.export?.text?.(element({ refId: 'k1', size: 'm' }), undefined)).toBe('k1');
  });

  it('menerima definisi minimal tanpa field opsional', () => {
    expect(() => defineElement({ type: 'x', version: 1, props: schema({}) })).not.toThrow();
  });

  it('menolak type kosong, berspasi, atau bukan string', () => {
    for (const type of ['', 'dua kata', 42]) {
      const errors = definitionErrors(() => card({ type }));
      expect(errors).toContain('type wajib berupa string tidak kosong tanpa spasi.');
    }
  });

  it('pesan error menyebut tipe bila type valid', () => {
    expect(() => card({ version: 0 })).toThrowError(
      /^Definisi elemen "contact-card" tidak valid: version wajib/,
    );
    try {
      card({ type: '' });
    } catch (error) {
      expect((error as ElementDefinitionError).type).toBeUndefined();
      expect((error as Error).message).toMatch(/^Definisi elemen tidak valid:/);
      expect((error as Error).name).toBe('ElementDefinitionError');
    }
  });

  it('menolak version yang bukan bilangan bulat >= 1', () => {
    for (const version of [0, -1, 1.5, '1', Number.NaN]) {
      expect(definitionErrors(() => card({ version }))).toContain(
        'version wajib berupa bilangan bulat mulai 1.',
      );
    }
  });

  it('menolak props yang bukan skema objek', () => {
    for (const props of [undefined, string(), { kind: 'object' }]) {
      expect(definitionErrors(() => card({ props, defaults: undefined }))).toContain(
        'props wajib berupa skema objek dari schema() atau object().',
      );
    }
  });

  it('menolak definisi yang bukan objek', () => {
    expect(definitionErrors(() => defineElement(null as never))).toEqual([
      'Definisi elemen wajib berupa objek.',
    ]);
  });

  describe('defaults', () => {
    it('boleh tidak lengkap: kunci wajib tanpa default tidak dituntut', () => {
      expect(() => card({ defaults: {} })).not.toThrow();
      expect(() => card({ defaults: { size: 'l', note: 'x' } })).not.toThrow();
      expect(() => card({ defaults: { note: undefined } })).not.toThrow();
    });

    it('menolak nilai yang tidak lolos skema kuncinya, dengan path', () => {
      const errors = definitionErrors(() => card({ defaults: { size: 'xl', refId: '' } }));
      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatch(/^defaults\.size tidak lolos skema props \(enum: /);
      expect(errors[1]).toMatch(/^defaults\.refId tidak lolos skema props \(too_small: /);
    });

    it('menolak kunci yang tidak ada di skema', () => {
      expect(definitionErrors(() => card({ defaults: { colour: 'red' } }))).toEqual([
        'defaults.colour tidak lolos skema props (unknown_key: unknown key).',
      ]);
    });

    it('menolak kunci wajib yang diberi undefined', () => {
      expect(definitionErrors(() => card({ defaults: { size: undefined } }))[0]).toMatch(
        /^defaults\.size tidak lolos skema props \(enum: /,
      );
    });

    it('memformat path array dengan indeks', () => {
      const errors = definitionErrors(() =>
        defineElement({
          type: 'pts',
          version: 1,
          props: schema({ points: array(array(number())) }),
          defaults: { points: [[1, 'x' as unknown as number]] },
        }),
      );
      expect(errors[0]).toMatch(/^defaults\.points\[0\]\[1\] tidak lolos/);
    });

    it('menolak defaults yang bukan objek', () => {
      expect(definitionErrors(() => card({ defaults: [] }))).toEqual([
        'defaults wajib berupa objek.',
      ]);
    });
  });

  it('menolak callback yang bukan fungsi', () => {
    const errors = definitionErrors(() =>
      card({
        geometry: 1,
        onDoubleClick: 'x',
        a11y: {},
        resolve: true,
        actions: [],
        placeholder: 0,
      }),
    );
    expect(errors).toEqual([
      'geometry wajib berupa fungsi.',
      'onDoubleClick wajib berupa fungsi.',
      'a11y wajib berupa fungsi.',
      'resolve wajib berupa fungsi.',
      'actions wajib berupa fungsi.',
      'placeholder wajib berupa fungsi.',
    ]);
  });

  it('menerima mode resize bawaan dan fungsi, menolak yang lain', () => {
    for (const resize of ['free', 'fixed-ratio', 'none', () => ({ w: 1, h: 1 })]) {
      expect(() => card({ resize })).not.toThrow();
    }
    expect(definitionErrors(() => card({ resize: 'scale' }))).toEqual([
      'resize wajib salah satu dari free, fixed-ratio, none, atau fungsi.',
    ]);
  });

  it('memeriksa render dan export', () => {
    expect(definitionErrors(() => card({ render: () => {}, export: 'x' }))).toEqual([
      'render wajib berupa objek { canvas?, html? }.',
      'export wajib berupa objek { text?, svg? }.',
    ]);
    expect(
      definitionErrors(() => card({ render: { canvas: 1, html: 2 }, export: { text: 'a' } })),
    ).toEqual([
      'render.canvas wajib berupa fungsi.',
      'render.html wajib berupa fungsi.',
      'export.text wajib berupa fungsi.',
    ]);
  });

  describe('migrate', () => {
    it('menerima kunci 0 sampai version - 1 dan boleh berlubang', () => {
      expect(() =>
        card({ version: 3, migrate: { 0: (p: object) => p, 2: (p: object) => p } }),
      ).not.toThrow();
    });

    it('menolak kunci >= version, negatif, atau bukan bilangan bulat', () => {
      const errors = definitionErrors(() =>
        card({
          version: 2,
          migrate: { 1: (p: object) => p, 2: (p: object) => p, '-1': (p: object) => p, '01': 1 },
        }),
      );
      expect(errors).toEqual([
        'migrate["2"]: kunci wajib bilangan bulat 0 sampai version - 1 (1).',
        'migrate["-1"]: kunci wajib bilangan bulat 0 sampai version - 1 (1).',
        'migrate["01"]: kunci wajib bilangan bulat 0 sampai version - 1 (1).',
        'migrate["01"] wajib berupa fungsi.',
      ]);
    });

    it('tetap memeriksa format kunci bila version tidak valid', () => {
      const errors = definitionErrors(() => card({ version: 'x', migrate: { a: () => ({}) } }));
      expect(errors).toContain('migrate["a"]: kunci wajib bilangan bulat 0 sampai version - 1.');
    });

    it('menolak migrate yang bukan objek', () => {
      expect(definitionErrors(() => card({ migrate: [] }))).toEqual([
        'migrate wajib berupa objek { [versiAsal]: fungsi }.',
      ]);
    });
  });

  it('memeriksa lod.compactBelowZoom', () => {
    for (const lod of [{ compactBelowZoom: 0 }, { compactBelowZoom: Infinity }, {}, 1]) {
      expect(definitionErrors(() => card({ lod }))).toEqual([
        'lod.compactBelowZoom wajib berupa angka lebih dari 0.',
      ]);
    }
  });

  it('memeriksa references pada definisi elemen (BOARD-1802)', () => {
    expect(definitionErrors(() => card({ references: 'not-a-fn' }))).toEqual([
      'references wajib berupa fungsi.',
    ]);

    const def = card({
      references: (el: ElementRecord<{ refId: string }>) => [
        { resolver: 'card', id: el.props.refId },
      ],
    });
    expect(def.references?.(element({ refId: 'c-123', size: 'm' }))).toEqual([
      { resolver: 'card', id: 'c-123' },
    ]);
  });
});

describe('createElementRegistry', () => {
  it('mendaftarkan, mencari, dan mendaftar sesuai urutan', () => {
    const a = card();
    const b = defineElement({ type: 'b', version: 1, props: schema({}) });
    const registry = createElementRegistry([a]);
    registry.register(b);
    expect(registry.get('contact-card')).toBe(a);
    expect(registry.has('b')).toBe(true);
    expect(registry.list()).toEqual([a, b]);
    expect(Object.isFrozen(registry.list())).toBe(true);
  });

  it('tipe tidak dikenal: get undefined, has false', () => {
    const registry = createElementRegistry();
    expect(registry.get('unknown')).toBeUndefined();
    expect(registry.has('unknown')).toBe(false);
    expect(registry.list()).toEqual([]);
  });

  it('menolak tipe ganda dengan pesan jelas', () => {
    const registry = createElementRegistry([card()]);
    let thrown: unknown;
    try {
      registry.register(card());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ElementDefinitionError);
    const error = thrown as ElementDefinitionError;
    expect(error.code).toBe('duplicate-type');
    expect(error.type).toBe('contact-card');
    expect(error.errors).toEqual([]);
    expect(error.message).toBe(
      'Tipe elemen "contact-card" sudah terdaftar. Setiap tipe hanya boleh didaftarkan sekali; ' +
        'pakai nama tipe lain atau pastikan plugin yang sama tidak dipasang dua kali.',
    );
    expect(registry.list()).toHaveLength(1);
  });

  it('menolak definisi ganda di daftar awal', () => {
    const def = card();
    expect(() => createElementRegistry([def, def])).toThrowError(/sudah terdaftar/);
  });

  it('memvalidasi definisi yang tidak dibuat lewat defineElement', () => {
    const registry = createElementRegistry();
    const raw = { type: 'raw', version: 0, props: schema({}) } as AnyElementDefinition;
    expect(() => registry.register(raw)).toThrowError(ElementDefinitionError);
    expect(registry.has('raw')).toBe(false);
  });

  it('registri terpisah tidak berbagi state', () => {
    const first = createElementRegistry([card()]);
    const second = createElementRegistry();
    expect(first.has('contact-card')).toBe(true);
    expect(second.has('contact-card')).toBe(false);
  });

  describe('validateElementProps', () => {
    const registry = createElementRegistry([card()]);

    it('mengembalikan objek yang sama bila valid', () => {
      const props = { refId: 'k1', size: 'l' };
      expect(registry.validateElementProps('contact-card', props)).toEqual({
        ok: true,
        value: props,
      });
    });

    it('mengembalikan issue bila tidak valid', () => {
      const result = registry.validateElementProps('contact-card', { size: 'xl', extra: 1 });
      expect(result?.ok).toBe(false);
      expect(result && !result.ok && result.issues.map((i) => [i.path, i.code])).toEqual([
        [['refId'], 'required'],
        [['size'], 'enum'],
        [['extra'], 'unknown_key'],
      ]);
    });

    it('mengembalikan undefined untuk tipe tidak dikenal', () => {
      expect(registry.validateElementProps('unknown', {})).toBeUndefined();
    });
  });
});

describe('geometry', () => {
  it('membuat primitif dengan nilai bawaan', () => {
    expect(rect(10, 20)).toEqual({ kind: 'rect', x: 0, y: 0, w: 10, h: 20 });
    expect(rect(10, 20, 1, 2)).toEqual({ kind: 'rect', x: 1, y: 2, w: 10, h: 20 });
    expect(ellipse(10, 20)).toEqual({ kind: 'ellipse', x: 0, y: 0, w: 10, h: 20 });
    expect(ellipse(10, 20, 3, 4)).toEqual({ kind: 'ellipse', x: 3, y: 4, w: 10, h: 20 });
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(polygon(points)).toEqual({ kind: 'polygon', points });
    expect(polyline(points)).toEqual({ kind: 'polyline', points, width: 0 });
    expect(polyline(points, 4).width).toBe(4);
  });
});
