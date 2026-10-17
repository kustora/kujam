import { describe, expect, it } from 'vitest';
import {
  CommandError,
  createBoard,
  createElementRegistry,
  defineCommand,
  defineElement,
  definePlugin,
  defineTool,
  ElementDefinitionError,
  PluginError,
  resolvePluginOrder,
  schema,
  string,
  ToolError,
  type AnyPluginDefinition,
  type BoardDocument,
} from './index.js';

function makeElementDef(type: string) {
  return defineElement({
    type,
    version: 1,
    props: schema({ label: string() }),
    defaults: { label: type },
  });
}

function makeToolDef(id: string) {
  return defineTool({
    id,
    cursor: 'crosshair',
    initial: 'idle',
    states: {
      idle: {
        onPointerDown: () => 'active',
      },
      active: {
        onPointerUp: () => 'idle',
      },
    },
  });
}

function makeCommandDef(id: string) {
  return defineCommand({
    id,
    label: `command.${id}`,
    run: (board) => {
      board.setCamera({ x: 42 });
    },
  });
}

function pluginValidationErrors(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(PluginError);
    expect((error as PluginError).code).toBe('invalid-plugin');
    return (error as PluginError).errors;
  }
  throw new Error('diharapkan melempar PluginError');
}

describe('definePlugin', () => {
  it('menerima semua field kontrak BOARD-602 dan membekukan objek definisi', () => {
    const cardEl = makeElementDef('contact-card');
    const stampTool = makeToolDef('contoh.cap');
    const alignCmd = makeCommandDef('contoh.rata-kiri');
    const logs: string[] = [];

    const plugin = definePlugin({
      id: 'contoh.lengkap',
      dependsOn: ['dasar'],
      elements: [cardEl],
      tools: [stampTool],
      brushes: [
        {
          id: 'marker',
          label: 'Spidol',
          strokeOptions: { size: 8, thinning: 0.2 },
          blend: 'multiply',
        },
      ],
      commands: [alignCmd],
      keybindings: {
        k: 'tool:contoh.cap',
        'Mod+Shift+l': 'contoh.rata-kiri',
      },
      toolbarItems: [
        {
          id: 'item-cap',
          label: 'Cap Kartu',
          icon: 'stamp',
          toolId: 'contoh.cap',
          commandId: 'contoh.rata-kiri',
          group: 'utama',
          order: 10,
        },
      ],
      exporters: [
        {
          format: 'markdown',
          label: 'Markdown',
          export: (board) => Object.keys(board.getDocument().records).join(','),
        },
      ],
      migrations: {
        0: (doc: BoardDocument) => ({ ...doc, meta: { ...doc.meta, migrated: true } }),
      },
      permissions: (action, el, user) => action !== 'delete' || el?.locked !== true || !!user,
      onDocumentSaved: (doc) => {
        logs.push(`saved:${doc.schemaVersion}`);
      },
      setup(board) {
        logs.push(`setup:${board.locale}`);
        return () => {
          logs.push('teardown');
        };
      },
    });

    expect(Object.isFrozen(plugin)).toBe(true);
    expect(plugin.id).toBe('contoh.lengkap');
    expect(plugin.elements).toEqual([cardEl]);
    expect(plugin.tools).toEqual([stampTool]);
    expect(plugin.brushes?.[0]?.id).toBe('marker');
    expect(plugin.keybindings?.k).toBe('tool:contoh.cap');
    expect(plugin.toolbarItems?.[0]?.id).toBe('item-cap');
    expect(plugin.exporters?.[0]?.format).toBe('markdown');
    expect(plugin.migrations?.[0]).toBeTypeOf('function');
    expect(plugin.permissions?.('create', null, { id: 'u1' })).toBe(true);
  });

  it('menerima definisi minimal hanya dengan id', () => {
    const minimal = definePlugin({ id: 'minimal' });
    expect(minimal.id).toBe('minimal');
    expect(Object.isFrozen(minimal)).toBe(true);
  });

  it('menolak definisi yang bukan objek plain', () => {
    for (const bad of [null, undefined, 42, 'plugin', []]) {
      expect(pluginValidationErrors(() => definePlugin(bad as never))).toEqual([
        'Definisi plugin wajib berupa objek.',
      ]);
    }
  });

  it('menolak id tidak valid dan menyertakan pluginId bila tersedia', () => {
    for (const id of ['', 'HurufBesar', 'ada spasi', '.awal', 'akhir.', 123]) {
      const errors = pluginValidationErrors(() => definePlugin({ id: id as string }));
      expect(errors).toContain(
        'id wajib huruf kecil, angka, titik, atau tanda hubung (misalnya "default-elements").',
      );
    }

    try {
      definePlugin({ id: '' });
    } catch (error) {
      expect((error as PluginError).pluginId).toBeUndefined();
      expect((error as Error).message).toMatch(/^Definisi plugin tidak valid:/);
    }

    try {
      definePlugin({ id: 'contoh.rusak', setup: 123 as never });
    } catch (error) {
      expect((error as PluginError).pluginId).toBe('contoh.rusak');
      expect((error as Error).message).toMatch(/^Definisi plugin "contoh\.rusak" tidak valid:/);
    }
  });

  describe('validasi dependsOn', () => {
    it('menolak dependsOn yang bukan array, ID tidak valid, atau duplikat', () => {
      expect(
        pluginValidationErrors(() => definePlugin({ id: 'p', dependsOn: 'lain' as never })),
      ).toEqual(['dependsOn wajib berupa array ID plugin.']);

      expect(
        pluginValidationErrors(() =>
          definePlugin({ id: 'p', dependsOn: ['valid', '', 'valid', 'Salah'] }),
        ),
      ).toEqual([
        'dependsOn[1] wajib berupa ID plugin yang valid.',
        'dependsOn[2] ("valid") duplikat di dalam plugin yang sama.',
        'dependsOn[3] wajib berupa ID plugin yang valid.',
      ]);
    });
  });

  describe('validasi elements, tools, dan commands', () => {
    it('menolak elements bukan array, elemen tidak valid, atau tipe duplikat dalam satu plugin', () => {
      expect(
        pluginValidationErrors(() => definePlugin({ id: 'p', elements: {} as never })),
      ).toEqual(['elements wajib berupa array definisi elemen.']);

      const el = makeElementDef('kotak');
      expect(
        pluginValidationErrors(() =>
          definePlugin({
            id: 'p',
            elements: [el, el, { type: '', version: 0, props: null } as never],
          }),
        ),
      ).toEqual([
        'elements[1]: tipe elemen "kotak" duplikat di dalam plugin yang sama.',
        'elements[2]: type wajib berupa string tidak kosong tanpa spasi.',
        'elements[2]: version wajib berupa bilangan bulat mulai 1.',
        'elements[2]: props wajib berupa skema objek dari schema() atau object().',
      ]);
    });

    it('menolak tools bukan array, tool tidak valid, atau id tool duplikat dalam satu plugin', () => {
      expect(pluginValidationErrors(() => definePlugin({ id: 'p', tools: 'x' as never }))).toEqual([
        'tools wajib berupa array definisi tool.',
      ]);

      const tool = makeToolDef('kuas');
      expect(
        pluginValidationErrors(() =>
          definePlugin({
            id: 'p',
            tools: [tool, tool, { id: 'Salah', initial: 'idle', states: {} } as never],
          }),
        ),
      ).toEqual([
        'tools[1]: tool "kuas" duplikat di dalam plugin yang sama.',
        'tools[2]: id wajib huruf kecil, angka, titik, atau tanda hubung (misalnya "pen").',
        'tools[2]: states wajib berupa objek dengan minimal satu state.',
      ]);
    });

    it('mendukung commands berupa array maupun peta objek, serta menolak yang tidak valid', () => {
      const cmd = makeCommandDef('contoh.satu');
      const p1 = definePlugin({
        id: 'p1',
        commands: [cmd],
      });
      const p2 = definePlugin({
        id: 'p2',
        commands: {
          'contoh.dua': (board) => board.setCamera({ y: 10 }),
          'contoh.tiga': {
            label: 'Tiga',
            isEnabled: (board) => !board.readOnly,
            run: (board) => board.setCamera({ x: 3 }),
          },
          'contoh.empat': {
            id: 'contoh.empat',
            run: () => {},
          },
        },
      });
      expect(p1.id).toBe('p1');
      expect(p2.id).toBe('p2');

      expect(pluginValidationErrors(() => definePlugin({ id: 'p', commands: 1 as never }))).toEqual(
        ['commands wajib berupa array definisi perintah atau objek peta { [id]: perintah }.'],
      );

      expect(
        pluginValidationErrors(() =>
          definePlugin({
            id: 'p',
            commands: [cmd, cmd, { id: 'tanpa-titik', label: '', run: 'bukan-fn' } as never],
          }),
        ),
      ).toEqual([
        'commands[1]: perintah "contoh.satu" duplikat di dalam plugin yang sama.',
        "commands[2]: id wajib bernamespace: segmen huruf kecil, angka, atau tanda hubung yang dipisah titik (misalnya 'layer.bring-forward').",
        'commands[2]: label wajib berupa kunci i18n tidak kosong.',
        'commands[2]: run wajib berupa fungsi.',
      ]);

      expect(
        pluginValidationErrors(() =>
          definePlugin({
            id: 'p',
            commands: {
              'contoh.beda': { id: 'contoh.lain', label: 'L', run: () => {} },
              'contoh.bukan-objek': 42 as never,
              'tanpa-namespace': () => {},
            },
          }),
        ),
      ).toEqual([
        'commands["contoh.beda"]: id "contoh.lain" tidak sama dengan kunci "contoh.beda".',
        'commands["contoh.bukan-objek"]: wajib berupa fungsi atau objek definisi perintah.',
        'commands["tanpa-namespace"]: id wajib bernamespace: segmen huruf kecil, angka, atau tanda hubung yang dipisah titik (misalnya \'layer.bring-forward\').',
      ]);
    });
  });

  describe('validasi field ekstensi lainnya', () => {
    it('memvalidasi brushes', () => {
      expect(pluginValidationErrors(() => definePlugin({ id: 'p', brushes: {} as never }))).toEqual(
        ['brushes wajib berupa array definisi kuas.'],
      );
      expect(
        pluginValidationErrors(() =>
          definePlugin({
            id: 'p',
            brushes: [
              null as never,
              { id: 'pen' },
              { id: 'pen', label: '', strokeOptions: [] as never, blend: '' },
              { id: 'Salah Id' },
            ],
          }),
        ),
      ).toEqual([
        'brushes[0] wajib berupa objek.',
        'brushes[2]: kuas "pen" duplikat di dalam plugin yang sama.',
        'brushes[2].label wajib berupa string tidak kosong.',
        'brushes[2].strokeOptions wajib berupa objek.',
        expect.stringMatching(/^brushes\[2\]\.blend wajib salah satu dari: source-over, /),
        'brushes[3].id wajib huruf kecil, angka, titik, atau tanda hubung (misalnya "pen").',
      ]);
    });

    it('memvalidasi keybindings', () => {
      expect(
        pluginValidationErrors(() => definePlugin({ id: 'p', keybindings: [] as never })),
      ).toEqual(['keybindings wajib berupa objek { [shortcut]: target }.']);

      expect(
        pluginValidationErrors(() =>
          definePlugin({
            id: 'p',
            keybindings: {
              '   ': 'contoh.aksi',
              k: '   ',
              'Hyper+K': 'contoh.aksi',
              'Mod+Kunci': 'contoh.aksi',
            },
          }),
        ),
      ).toEqual([
        'keybindings: Shortcut wajib berupa string tidak kosong.',
        'keybindings["k"] wajib berupa string target tidak kosong.',
        'keybindings: Shortcut "Hyper+K" memakai modifier "Hyper" yang tidak dikenal.',
        'keybindings: Shortcut "Mod+Kunci" memakai tombol "Kunci" yang tidak dikenal.',
      ]);
    });

    it('memvalidasi toolbarItems', () => {
      expect(
        pluginValidationErrors(() => definePlugin({ id: 'p', toolbarItems: {} as never })),
      ).toEqual(['toolbarItems wajib berupa array item toolbar.']);

      expect(
        pluginValidationErrors(() =>
          definePlugin({
            id: 'p',
            toolbarItems: [
              null as never,
              { id: 'item-1', label: 'Item 1' },
              {
                id: 'item-1',
                label: '',
                icon: '',
                toolId: '',
                commandId: '',
                group: '',
                order: Number.NaN,
              },
              { id: '  ', label: 'Valid' },
            ],
          }),
        ),
      ).toEqual([
        'toolbarItems[0] wajib berupa objek.',
        'toolbarItems[2]: id "item-1" duplikat di dalam plugin yang sama.',
        'toolbarItems[2].label wajib berupa string tidak kosong.',
        'toolbarItems[2].icon wajib berupa string tidak kosong.',
        'toolbarItems[2].toolId wajib berupa string tidak kosong.',
        'toolbarItems[2].commandId wajib berupa string tidak kosong.',
        'toolbarItems[2].group wajib berupa string tidak kosong.',
        'toolbarItems[2].order wajib berupa angka berhingga.',
        'toolbarItems[3].id wajib berupa string tidak kosong.',
      ]);
    });

    it('memvalidasi exporters', () => {
      expect(
        pluginValidationErrors(() => definePlugin({ id: 'p', exporters: {} as never })),
      ).toEqual(['exporters wajib berupa array definisi eksportir.']);

      expect(
        pluginValidationErrors(() =>
          definePlugin({
            id: 'p',
            exporters: [
              null as never,
              { format: 'svg', export: () => '' },
              { format: 'svg', label: '', export: 123 as never },
              { format: '', export: () => '' },
            ],
          }),
        ),
      ).toEqual([
        'exporters[0] wajib berupa objek.',
        'exporters[2]: format "svg" duplikat di dalam plugin yang sama.',
        'exporters[2].label wajib berupa string tidak kosong.',
        'exporters[2].export wajib berupa fungsi.',
        'exporters[3].format wajib berupa string tidak kosong.',
      ]);
    });

    it('memvalidasi migrations dan callback fungsi', () => {
      expect(
        pluginValidationErrors(() => definePlugin({ id: 'p', migrations: [] as never })),
      ).toEqual(['migrations wajib berupa objek { [versiAsal]: fungsi }.']);

      expect(
        pluginValidationErrors(() =>
          definePlugin({
            id: 'p',
            migrations: { '-1': (d: BoardDocument) => d, '01': 'bukan-fn' as never },
            permissions: 'ya' as never,
            onDocumentSaved: {} as never,
            setup: true as never,
          }),
        ),
      ).toEqual([
        'migrations["-1"]: kunci wajib bilangan bulat mulai 0.',
        'migrations["01"]: kunci wajib bilangan bulat mulai 0.',
        'migrations["01"] wajib berupa fungsi.',
        'permissions wajib berupa fungsi.',
        'onDocumentSaved wajib berupa fungsi.',
        'setup wajib berupa fungsi.',
      ]);
    });
  });
});

describe('resolvePluginOrder (urutan deterministik & dependsOn)', () => {
  it('mempertahankan urutan input bila tidak ada dependsOn', () => {
    const a = definePlugin({ id: 'a' });
    const b = definePlugin({ id: 'b' });
    const c = definePlugin({ id: 'c' });

    const ordered = resolvePluginOrder([a, b, c]);
    expect(ordered.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(Object.isFrozen(ordered)).toBe(true);
  });

  it('mengurutkan grafik ketergantungan rantai dan berlian secara deterministik', () => {
    const dasar = definePlugin({ id: 'dasar' });
    const kiri = definePlugin({ id: 'kiri', dependsOn: ['dasar'] });
    const kanan = definePlugin({ id: 'kanan', dependsOn: ['dasar'] });
    const puncak = definePlugin({ id: 'puncak', dependsOn: ['kiri', 'kanan'] });

    // Even though the top plugin is given first, its prerequisites are installed first per dependsOn order.
    const ordered = resolvePluginOrder([puncak, kanan, kiri, dasar]);
    expect(ordered.map((p) => p.id)).toEqual(['dasar', 'kiri', 'kanan', 'puncak']);
  });

  it('membekukan objek plugin mentah yang tidak dibuat lewat definePlugin', () => {
    const raw: AnyPluginDefinition = { id: 'mentah' };
    const [first] = resolvePluginOrder([raw]);
    expect(first?.id).toBe('mentah');
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('menolak input yang bukan iterable', () => {
    const msg = 'Opsi plugins wajib berupa iterable definisi plugin.';
    expect(() => resolvePluginOrder(null as never)).toThrowError(
      new PluginError('invalid-plugin', msg, undefined, [msg]),
    );
    expect(() => resolvePluginOrder(123 as never)).toThrow(PluginError);
  });

  it('menolak ID plugin ganda dengan kode duplicate-plugin', () => {
    const a1 = definePlugin({ id: 'sama' });
    const a2 = definePlugin({ id: 'sama' });
    let caught: unknown;
    try {
      resolvePluginOrder([a1, a2]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PluginError);
    expect((caught as PluginError).code).toBe('duplicate-plugin');
    expect((caught as PluginError).pluginId).toBe('sama');
  });

  it('menolak dependensi yang belum dipasang dengan kode missing-dependency', () => {
    const butuh = definePlugin({ id: 'fitur', dependsOn: ['inti-bentuk'] });
    let caught: unknown;
    try {
      resolvePluginOrder([butuh]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PluginError);
    expect((caught as PluginError).code).toBe('missing-dependency');
    expect((caught as PluginError).pluginId).toBe('fitur');
    expect((caught as PluginError).message).toBe(
      'Plugin "fitur" membutuhkan plugin "inti-bentuk" yang belum dipasang.',
    );
  });

  it('menolak siklus langsung maupun siklus panjang dengan kode circular-dependency', () => {
    const sendiri = definePlugin({ id: 'mandiri', dependsOn: ['mandiri'] });
    expect(() => resolvePluginOrder([sendiri])).toThrowError(
      'Siklus dependensi plugin terdeteksi: mandiri -> mandiri.',
    );

    const a = definePlugin({ id: 'a', dependsOn: ['c'] });
    const b = definePlugin({ id: 'b', dependsOn: ['a'] });
    const c = definePlugin({ id: 'c', dependsOn: ['b'] });
    let caught: unknown;
    try {
      resolvePluginOrder([a, b, c]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PluginError);
    expect((caught as PluginError).code).toBe('circular-dependency');
    expect((caught as PluginError).message).toBe(
      'Siklus dependensi plugin terdeteksi: a -> c -> b -> a.',
    );
  });
});

describe('pemasangan plugin di createBoard', () => {
  it('mendaftarkan elements, tools, dan commands serta menjalankan setup/teardown sesuai urutan', () => {
    const urutan: string[] = [];

    const pluginDasar = definePlugin({
      id: 'dasar',
      elements: [makeElementDef('catatan')],
      tools: [makeToolDef('pilih-catatan')],
      commands: [makeCommandDef('dasar.reset-kamera')],
      setup(board) {
        urutan.push(`setup:dasar:el=${board.elements.has('catatan')}`);
        return () => {
          urutan.push('teardown:dasar');
        };
      },
    });

    const pluginLanjut = definePlugin({
      id: 'lanjut',
      dependsOn: ['dasar'],
      elements: [makeElementDef('kartu-kontak')],
      commands: {
        'lanjut.aktif-tool': (board) => board.setTool('pilih-catatan'),
        'lanjut.hanya-baca': {
          label: 'Cek Baca',
          isEnabled: (board) => !board.readOnly,
          run: () => urutan.push('cmd:lanjut'),
        },
      },
      setup(board) {
        // When `lanjut`'s setup runs, `dasar` is already fully installed.
        urutan.push(`setup:lanjut:hasDasar=${board.plugins.has('dasar')}`);
        board.run('lanjut.aktif-tool');
        return () => {
          urutan.push('teardown:lanjut');
        };
      },
    });

    const pluginTanpaTeardown = definePlugin({
      id: 'tanpa-teardown',
      dependsOn: ['lanjut'],
      setup() {
        urutan.push('setup:tanpa-teardown');
      },
    });

    // Given in reverse to prove installation order follows dependsOn.
    const board = createBoard({
      plugins: new Set([pluginTanpaTeardown, pluginLanjut, pluginDasar]),
    });

    expect(board.plugins.list().map((p) => p.id)).toEqual(['dasar', 'lanjut', 'tanpa-teardown']);
    expect(board.plugins.get('dasar')).toBe(pluginDasar);
    expect(board.plugins.get('tidak-ada')).toBeUndefined();
    expect(board.plugins.has('lanjut')).toBe(true);
    expect(board.plugins.has('tidak-ada')).toBe(false);

    expect(board.elements.list().map((e) => e.type)).toEqual(['catatan', 'kartu-kontak']);
    expect(board.tools.has('pilih-catatan')).toBe(true);
    expect(board.tool).toBe('pilih-catatan');
    expect(board.commands.has('dasar.reset-kamera')).toBe(true);
    expect(board.commands.has('lanjut.aktif-tool')).toBe(true);

    board.run('dasar.reset-kamera');
    expect(board.getCamera().x).toBe(42);
    board.run('lanjut.hanya-baca');

    expect(urutan).toEqual([
      'setup:dasar:el=true',
      'setup:lanjut:hasDasar=true',
      'setup:tanpa-teardown',
      'cmd:lanjut',
    ]);

    // Dispose runs teardowns in reverse order (lanjut -> dasar), and is safe to call twice.
    board.dispose();
    board.dispose();
    expect(urutan).toEqual([
      'setup:dasar:el=true',
      'setup:lanjut:hasDasar=true',
      'setup:tanpa-teardown',
      'cmd:lanjut',
      'teardown:lanjut',
      'teardown:dasar',
    ]);
    expect(board.plugins.list()).toEqual([]);
  });

  it('me-rollback plugin yang sudah sempat dipasang bila plugin berikutnya gagal', () => {
    const jejak: string[] = [];

    const p1 = definePlugin({
      id: 'p1',
      tools: [makeToolDef('tool-p1')],
      commands: [makeCommandDef('p1.aksi')],
      setup() {
        jejak.push('setup:p1');
        return () => {
          jejak.push('rollback:p1');
          // Errors inside teardown during rollback are ignored so the original error is not swallowed.
          throw new Error('error rollback diabaikan');
        };
      },
    });

    const p2 = definePlugin({
      id: 'p2',
      dependsOn: ['p1'],
      setup() {
        jejak.push('setup:p2');
        throw new Error('setup p2 meledak');
      },
    });

    expect(() => createBoard({ plugins: [p1, p2] })).toThrowError('setup p2 meledak');
    expect(jejak).toEqual(['setup:p1', 'setup:p2', 'rollback:p1']);
  });

  it('menolak nilai kembali setup yang bukan fungsi atau undefined dan melakukan rollback', () => {
    let dibersihkan = false;
    const p1 = definePlugin({
      id: 'p1',
      setup: () => () => {
        dibersihkan = true;
      },
    });
    const pRusak = definePlugin({
      id: 'rusak',
      dependsOn: ['p1'],
      setup: (() => 'bukan-fungsi') as never,
    });

    const msg = 'setup plugin "rusak" wajib mengembalikan fungsi teardown atau undefined.';
    expect(() => createBoard({ plugins: [p1, pRusak] })).toThrowError(
      new PluginError('invalid-plugin', msg, 'rusak', [msg]),
    );
    expect(dibersihkan).toBe(true);
  });

  it('menolak bentrok elemen, tool, atau perintah antar plugin berbeda', () => {
    const elA = definePlugin({ id: 'a', elements: [makeElementDef('sama')] });
    const elB = definePlugin({ id: 'b', elements: [makeElementDef('sama')] });
    expect(() => createBoard({ plugins: [elA, elB] })).toThrow(ElementDefinitionError);

    const toolA = definePlugin({ id: 'a', tools: [makeToolDef('sama')] });
    const toolB = definePlugin({ id: 'b', tools: [makeToolDef('sama')] });
    expect(() => createBoard({ plugins: [toolA, toolB] })).toThrow(ToolError);

    const cmdA = definePlugin({ id: 'a', commands: [makeCommandDef('ns.sama')] });
    const cmdB = definePlugin({ id: 'b', commands: [makeCommandDef('ns.sama')] });
    expect(() => createBoard({ plugins: [cmdA, cmdB] })).toThrow(CommandError);
  });

  it('tetap menjalankan seluruh teardown lain dan membersihkan board walau salah satu teardown melempar', () => {
    const jejak: string[] = [];
    const p1 = definePlugin({
      id: 'p1',
      setup: () => () => {
        jejak.push('teardown:p1');
      },
    });
    const p2 = definePlugin({
      id: 'p2',
      dependsOn: ['p1'],
      setup: () => () => {
        jejak.push('teardown:p2');
        throw new Error('gagal di p2');
      },
    });
    const p3 = definePlugin({
      id: 'p3',
      dependsOn: ['p2'],
      setup: () => () => {
        jejak.push('teardown:p3');
        throw new Error('gagal di p3');
      },
    });

    const board = createBoard({ plugins: [p1, p2, p3] });
    expect(() => board.dispose()).toThrowError('gagal di p3');
    // p2 and p1 still run even though p3 throws first.
    expect(jejak).toEqual(['teardown:p3', 'teardown:p2', 'teardown:p1']);
    // The board still enters the disposed state.
    expect(() => board.undo()).toThrowError('Papan sudah di-dispose.');
  });

  it('createElementRegistry menerima objek plugin maupun iterable elemen', () => {
    const p = definePlugin({
      id: 'dengan-elemen',
      elements: [makeElementDef('satu'), makeElementDef('dua')],
    });
    const regDariPlugin = createElementRegistry(p);
    expect(regDariPlugin.list().map((e) => e.type)).toEqual(['satu', 'dua']);

    const regTanpaElemen = createElementRegistry(definePlugin({ id: 'kosong' }));
    expect(regTanpaElemen.list()).toEqual([]);
  });
});
