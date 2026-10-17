import { describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  object,
  string,
  type BoardErrorEvent,
  type ElementAction,
  type ElementRecord,
  type PermissionHook,
} from './index.js';

const noteElement = defineElement({
  type: 'note',
  version: 1,
  props: object({
    text: string(),
    color: string(),
  }),
  defaults: {
    text: '',
    color: 'yellow',
  },
  geometry: (el) => ({ minX: el.x, minY: el.y, maxX: el.x + el.w, maxY: el.y + el.h }),
});

const basePlugin = definePlugin({
  id: 'base-notes',
  elements: [noteElement],
});

describe('BOARD-212: Hook izin permissions(action, element, user)', () => {
  it('mencegah board.create saat hook izin mengembalikan false dan memancarkan error forbidden', () => {
    const errorEvents: BoardErrorEvent[] = [];
    const permissionHook = vi.fn<PermissionHook>((action) => {
      if (action === 'create') return false;
      return true;
    });

    const board = createBoard({
      plugins: [basePlugin],
      user: { id: 'u_1', name: 'Budi', role: 'viewer' },
      permissions: permissionHook,
    });
    board.on('error', (e) => errorEvents.push(e));

    const result = board.create({
      type: 'note',
      props: { text: 'Catatan terlarang' },
    });

    expect(result).toBeUndefined();
    expect(permissionHook).toHaveBeenCalledWith(
      'create',
      expect.objectContaining({ type: 'note' }),
      expect.objectContaining({ id: 'u_1', name: 'Budi', role: 'viewer' }),
    );
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.code).toBe('forbidden');
    expect(errorEvents[0]!.message).toContain('Operasi "create"');

    // Dokumen tetap bersih tanpa elemen
    expect(board.query()).toHaveLength(0);
    board.dispose();
  });

  it('mengizinkan board.create saat hook izin mengembalikan true', () => {
    const errorEvents: BoardErrorEvent[] = [];
    const permissionHook = vi.fn<PermissionHook>(() => true);

    const board = createBoard({
      plugins: [basePlugin],
      user: { id: 'u_1', name: 'Budi', role: 'editor' },
      permissions: permissionHook,
    });
    board.on('error', (e) => errorEvents.push(e));

    const result = board.create({
      type: 'note',
      props: { text: 'Catatan sah' },
    });

    expect(result).toBeDefined();
    expect(result?.props.text).toBe('Catatan sah');
    expect(errorEvents).toHaveLength(0);
    expect(board.query()).toHaveLength(1);
    board.dispose();
  });

  it('mencegah board.update saat hook izin mengembalikan false dan memancarkan error forbidden', () => {
    const errorEvents: BoardErrorEvent[] = [];
    let allowUpdate = true;

    const board = createBoard({
      plugins: [basePlugin],
      user: { id: 'u_1', role: 'editor' },
      permissions: (action) => {
        if (action === 'update') return allowUpdate;
        return true;
      },
    });
    board.on('error', (e) => errorEvents.push(e));

    const el = board.create({ type: 'note', props: { text: 'Awal' } })!;
    expect(el).toBeDefined();

    // Sekarang larang update
    allowUpdate = false;
    const updated = board.update(el.id, { props: { text: 'Berubah' } });

    expect(updated).toBeUndefined();
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.code).toBe('forbidden');
    expect(errorEvents[0]!.message).toContain('Operasi "update"');

    // Nilai elemen tidak berubah di store
    expect(board.getElement(el.id)?.props.text).toBe('Awal');
    board.dispose();
  });

  it('mencegah board.delete saat hook izin mengembalikan false dan memancarkan error forbidden', () => {
    const errorEvents: BoardErrorEvent[] = [];
    let allowDelete = true;

    const board = createBoard({
      plugins: [basePlugin],
      user: { id: 'u_1', role: 'editor' },
      permissions: (action) => {
        if (action === 'delete') return allowDelete;
        return true;
      },
    });
    board.on('error', (e) => errorEvents.push(e));

    const el = board.create({ id: 'note-1', type: 'note' })!;
    expect(el).toBeDefined();

    // Larang delete
    allowDelete = false;
    const deleted = board.delete(el.id);

    expect(deleted).toEqual([]);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.code).toBe('forbidden');
    expect(errorEvents[0]!.message).toContain('Operasi "delete"');

    // Elemen tetap ada di papan
    expect(board.getElement(el.id)).toBeDefined();
    board.dispose();
  });

  it('membatalkan penghapusan secara atomik bila salah satu elemen dalam batch ditolak oleh hook izin', () => {
    const errorEvents: BoardErrorEvent[] = [];

    const board = createBoard({
      plugins: [basePlugin],
      permissions: (action, element) => {
        if (action === 'delete' && element?.id === 'protected-note') {
          return false;
        }
        return true;
      },
    });
    board.on('error', (e) => errorEvents.push(e));

    const el1 = board.create({ id: 'free-note-1', type: 'note' })!;
    const el2 = board.create({ id: 'protected-note', type: 'note' })!;
    const el3 = board.create({ id: 'free-note-2', type: 'note' })!;

    // Hapus batch berisi protected-note
    const deleted = board.delete([el1.id, el2.id, el3.id]);

    expect(deleted).toEqual([]);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.code).toBe('forbidden');

    // Tidak ada elemen yang terhapus
    expect(board.getElement(el1.id)).toBeDefined();
    expect(board.getElement(el2.id)).toBeDefined();
    expect(board.getElement(el3.id)).toBeDefined();
    board.dispose();
  });

  it('membatalkan cascade delete kontainer bila ada anak yang ditolak oleh hook izin', () => {
    const errorEvents: BoardErrorEvent[] = [];

    const board = createBoard({
      plugins: [basePlugin],
      permissions: (action, element) => {
        if (action === 'delete' && element?.id === 'child-protected') {
          return false;
        }
        return true;
      },
    });
    board.on('error', (e) => errorEvents.push(e));

    const parent = board.create({ id: 'parent-frame', type: 'note' })!;
    board.create({ id: 'child-free', type: 'note', parentId: parent.id });
    board.create({ id: 'child-protected', type: 'note', parentId: parent.id });

    // Hapus parent: cascade ke anak-anaknya, tapi child-protected ditolak
    const deleted = board.delete(parent.id);

    expect(deleted).toEqual([]);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.code).toBe('forbidden');

    // Seluruh hierarki tetap utuh
    expect(board.getElement('parent-frame')).toBeDefined();
    expect(board.getElement('child-free')).toBeDefined();
    expect(board.getElement('child-protected')).toBeDefined();
    board.dispose();
  });

  it('menjalankan aksi elemen lewat board.runAction dengan verifikasi izin', () => {
    const errorEvents: BoardErrorEvent[] = [];
    let allowAction = false;

    const board = createBoard({
      plugins: [basePlugin],
      permissions: (action) => {
        if (action === 'action') return allowAction;
        return true;
      },
    });
    board.on('error', (e) => errorEvents.push(e));

    const el = board.create({ id: 'note-action', type: 'note' })!;
    const runMock = vi.fn();
    const action: ElementAction = {
      id: 'custom.color-picker',
      label: 'Ubah Warna',
      run: runMock,
    };

    // Aksi ditolak oleh izin
    const success1 = board.runAction(action, el);
    expect(success1).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.code).toBe('forbidden');
    expect(errorEvents[0]!.message).toContain('Menjalankan aksi "custom.color-picker"');

    // Izinkan aksi
    allowAction = true;
    const success2 = board.runAction(action, el);
    expect(success2).toBe(true);
    expect(runMock).toHaveBeenCalledTimes(1);

    // Bila isEnabled() false, aksi tidak dijalankan dan tidak memancarkan error forbidden
    const disabledAction: ElementAction = {
      id: 'custom.disabled',
      label: 'Nonaktif',
      isEnabled: () => false,
      run: vi.fn(),
    };
    const success3 = board.runAction(disabledAction, el);
    expect(success3).toBe(false);
    expect(disabledAction.run).not.toHaveBeenCalled();
    expect(errorEvents).toHaveLength(1); // tidak bertambah

    board.dispose();
  });

  it('menggabungkan hook izin dari beberapa plugin dengan logika AND', () => {
    let pluginAAllow = true;
    let pluginBAllow = true;
    let pluginCAllow = true;

    const pluginA = definePlugin({
      id: 'plugin-a',
      permissions: () => pluginAAllow,
    });
    const pluginB = definePlugin({
      id: 'plugin-b',
      permissions: () => pluginBAllow,
    });
    const pluginC = definePlugin({
      id: 'plugin-c',
      permissions: () => pluginCAllow,
    });

    const board = createBoard({
      plugins: [basePlugin, pluginA, pluginB, pluginC],
    });

    // Semua mengizinkan -> true
    expect(board.can('create')).toBe(true);

    // Plugin A menolak -> false
    pluginAAllow = false;
    expect(board.can('create')).toBe(false);

    // Plugin A izinkan, Plugin B menolak -> false
    pluginAAllow = true;
    pluginBAllow = false;
    expect(board.can('create')).toBe(false);

    // Plugin B izinkan, Plugin C menolak -> false
    pluginBAllow = true;
    pluginCAllow = false;
    expect(board.can('create')).toBe(false);

    // Semua izinkan lagi -> true
    pluginCAllow = true;
    expect(board.can('create')).toBe(true);

    board.dispose();
  });

  it('menggabungkan hook aplikasi dengan hook plugin lewat logika AND', () => {
    let appAllow = true;
    let pluginAllow = true;

    const plugin = definePlugin({
      id: 'test-plugin',
      permissions: () => pluginAllow,
    });

    const board = createBoard({
      plugins: [basePlugin, plugin],
      permissions: () => appAllow,
    });

    expect(board.can('update')).toBe(true);

    // Plugin izinkan, aplikasi tolak -> false
    appAllow = false;
    expect(board.can('update')).toBe(false);

    // Aplikasi izinkan, plugin tolak -> false
    appAllow = true;
    pluginAllow = false;
    expect(board.can('update')).toBe(false);

    // Keduanya izinkan -> true
    pluginAllow = true;
    expect(board.can('update')).toBe(true);

    board.dispose();
  });

  it('board.can menguji izin tanpa memancarkan event error', () => {
    const errorEvents: BoardErrorEvent[] = [];
    const board = createBoard({
      plugins: [basePlugin],
      permissions: (action) => action !== 'custom.denied',
    });
    board.on('error', (e) => errorEvents.push(e));

    expect(board.can('create')).toBe(true);
    expect(board.can('custom.denied')).toBe(false);
    expect(errorEvents).toHaveLength(0);

    board.dispose();
    // Setelah dispose, can selalu mengembalikan false
    expect(board.can('create')).toBe(false);
  });

  it('menangani hook izin yang melempar exception secara aman (fail closed)', () => {
    const errorEvents: BoardErrorEvent[] = [];
    const board = createBoard({
      plugins: [basePlugin],
      permissions: () => {
        throw new Error('Crash sengaja dalam hook');
      },
    });
    board.on('error', (e) => errorEvents.push(e));

    // can mengembalikan false tanpa crash
    expect(board.can('create')).toBe(false);

    // create membatalkan operasi dan memancarkan event error forbidden
    const created = board.create({ type: 'note' });
    expect(created).toBeUndefined();
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.code).toBe('forbidden');

    board.dispose();
  });

  it('board.permissions mengembalikan komposit PermissionHook bila ada hook yang didaftarkan', () => {
    const pluginHook: PermissionHook = vi.fn(() => true);
    const plugin = definePlugin({
      id: 'hook-plugin',
      permissions: pluginHook,
    });

    const boardWithPlugin = createBoard({
      plugins: [basePlugin, plugin],
    });
    expect(typeof boardWithPlugin.permissions).toBe('function');
    expect(boardWithPlugin.permissions!('create', null, null)).toBe(true);
    expect(pluginHook).toHaveBeenCalled();
    boardWithPlugin.dispose();

    const boardWithoutHooks = createBoard({
      plugins: [basePlugin],
    });
    expect(boardWithoutHooks.permissions).toBeNull();
    boardWithoutHooks.dispose();
  });

  it('mendukung aturan peran pengguna (role-based) lewat board.user', () => {
    const roleBasedPermissions: PermissionHook = (action, _element, user) => {
      if (!user) return false;
      if (user.role === 'admin') return true;
      if (user.role === 'editor') {
        return action !== 'custom.delete-board';
      }
      if (user.role === 'viewer') {
        return action === 'read' || action === 'select';
      }
      return false;
    };

    const viewerBoard = createBoard({
      plugins: [basePlugin],
      user: { id: 'viewer-1', role: 'viewer' },
      permissions: roleBasedPermissions,
    });
    expect(viewerBoard.can('create')).toBe(false);
    expect(viewerBoard.can('update')).toBe(false);
    expect(viewerBoard.can('delete')).toBe(false);
    expect(viewerBoard.can('read')).toBe(true);
    viewerBoard.dispose();

    const editorBoard = createBoard({
      plugins: [basePlugin],
      user: { id: 'editor-1', role: 'editor' },
      permissions: roleBasedPermissions,
    });
    expect(editorBoard.can('create')).toBe(true);
    expect(editorBoard.can('update')).toBe(true);
    expect(editorBoard.can('delete')).toBe(true);
    expect(editorBoard.can('custom.delete-board')).toBe(false);
    editorBoard.dispose();
  });

  it('menolak argumen tidak valid pada board.runAction', () => {
    const board = createBoard({ plugins: [basePlugin] });
    const el = board.create({ type: 'note' })!;

    expect(() => board.runAction(null as unknown as ElementAction, el)).toThrow(TypeError);
    expect(() => board.runAction({ id: 'a' } as unknown as ElementAction, el)).toThrow(TypeError);
    expect(() =>
      board.runAction({ id: 'a', run: () => {} }, null as unknown as ElementRecord),
    ).toThrow(TypeError);

    board.dispose();
    expect(() => board.runAction({ id: 'a', run: () => {} }, el)).toThrow(
      'Papan sudah di-dispose.',
    );
  });
});
