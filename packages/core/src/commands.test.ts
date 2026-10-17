import { describe, expect, it, vi } from 'vitest';
import { CommandError, createBoard, defineCommand, type CommandDefinition } from './index.js';

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Diharapkan melempar.');
}

describe('registri perintah (BOARD-503)', () => {
  it('mendaftarkan, mencari, dan mendaftar perintah sesuai urutan pendaftaran', () => {
    const board = createBoard();
    const a = defineCommand({ id: 'contoh.a', label: 'command.contoh.a', run: () => {} });
    const b = defineCommand({ id: 'contoh.b', label: 'command.contoh.b', run: () => {} });
    board.commands.register(b);
    board.commands.register(a);

    expect(board.commands.get('contoh.a')).toBe(a);
    expect(board.commands.has('contoh.b')).toBe(true);
    expect(board.commands.get('contoh.tidak-ada')).toBeUndefined();
    expect(board.commands.list().map((c) => c.id)).toEqual(['contoh.b', 'contoh.a']);
    expect(Object.isFrozen(board.commands.list())).toBe(true);
  });

  it('board.run memanggil run dengan board dan argumen', () => {
    const board = createBoard();
    const run = vi.fn();
    board.commands.register({ id: 'contoh.geser', label: 'command.geser', run });

    expect(board.run('contoh.geser', { dx: 10 })).toBe(true);
    expect(run).toHaveBeenCalledWith(board, { dx: 10 });

    board.run('contoh.geser');
    expect(run).toHaveBeenLastCalledWith(board, undefined);
  });

  it('isEnabled menentukan apakah perintah dijalankan', () => {
    const board = createBoard();
    const run = vi.fn();
    let allowed = false;
    board.commands.register({
      id: 'contoh.kondisional',
      label: 'command.kondisional',
      isEnabled: (b, args) => {
        expect(b).toBe(board);
        return allowed && args !== 'tolak';
      },
      run,
    });

    expect(board.commands.isEnabled('contoh.kondisional')).toBe(false);
    expect(board.run('contoh.kondisional')).toBe(false);
    expect(run).not.toHaveBeenCalled();

    allowed = true;
    expect(board.commands.isEnabled('contoh.kondisional')).toBe(true);
    expect(board.commands.isEnabled('contoh.kondisional', 'tolak')).toBe(false);
    expect(board.run('contoh.kondisional')).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('perintah tanpa isEnabled selalu aktif; ID tidak terdaftar tidak aktif', () => {
    const board = createBoard();
    board.commands.register({ id: 'contoh.selalu', label: 'command.selalu', run: () => {} });
    expect(board.commands.isEnabled('contoh.selalu')).toBe(true);
    expect(board.commands.isEnabled('contoh.tidak-ada')).toBe(false);
  });

  it('board.run dengan ID tidak terdaftar melempar unknown-command', () => {
    const board = createBoard();
    const error = catchError(() => board.run('contoh.tidak-ada'));
    expect(error).toBeInstanceOf(CommandError);
    expect(error).toMatchObject({ code: 'unknown-command', commandId: 'contoh.tidak-ada' });
  });

  it('bentrok ID memicu error saat registrasi dan definisi lama tetap terdaftar', () => {
    const board = createBoard();
    const first = defineCommand({ id: 'plugin.sama', label: 'a', run: () => {} });
    board.commands.register(first);

    const error = catchError(() =>
      board.commands.register({ id: 'plugin.sama', label: 'b', run: () => {} }),
    );
    expect(error).toBeInstanceOf(CommandError);
    expect(error).toMatchObject({ code: 'duplicate-command', commandId: 'plugin.sama' });
    expect(board.commands.get('plugin.sama')).toBe(first);
  });

  it('fungsi pelepas menghapus perintah, idempoten, dan tidak menghapus pengganti', () => {
    const board = createBoard();
    const unregister = board.commands.register({ id: 'contoh.x', label: 'x', run: () => {} });
    unregister();
    expect(board.commands.has('contoh.x')).toBe(false);

    const replacement = defineCommand({ id: 'contoh.x', label: 'x2', run: () => {} });
    board.commands.register(replacement);
    unregister();
    expect(board.commands.get('contoh.x')).toBe(replacement);
  });

  it.each([
    ['tanpa namespace', { id: 'hapus', label: 'l', run: () => {} }],
    ['huruf besar', { id: 'Layer.Maju', label: 'l', run: () => {} }],
    ['segmen kosong', { id: 'layer..maju', label: 'l', run: () => {} }],
    ['spasi', { id: 'layer.bawa maju', label: 'l', run: () => {} }],
    ['label kosong', { id: 'layer.maju', label: '', run: () => {} }],
    ['run bukan fungsi', { id: 'layer.maju', label: 'l', run: 1 }],
    ['isEnabled bukan fungsi', { id: 'layer.maju', label: 'l', run: () => {}, isEnabled: true }],
    ['bukan objek', null],
  ])('menolak definisi tidak valid: %s', (_name, definition) => {
    const board = createBoard();
    const error = catchError(() =>
      board.commands.register(definition as unknown as CommandDefinition),
    );
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).code).toBe('invalid-command');
    expect((error as CommandError).errors.length).toBeGreaterThan(0);
    expect(board.commands.list()).toHaveLength(0);
  });

  it('menerima ID bernamespace bertingkat dan bertanda hubung', () => {
    const board = createBoard();
    for (const id of ['layer.bring-forward', 'contoh.kartu.sisipkan', 'x2.y3']) {
      board.commands.register({ id, label: id, run: () => {} });
    }
    expect(board.commands.list()).toHaveLength(3);
  });

  it('defineCommand memvalidasi segera dan membekukan definisi', () => {
    const command = defineCommand({ id: 'contoh.a', label: 'a', run: () => {} });
    expect(Object.isFrozen(command)).toBe(true);
    expect(() => defineCommand({ id: 'a', label: 'a', run: () => {} })).toThrow(CommandError);
  });

  it('definisi yang belum dibekukan disalin sehingga mutasi tidak memengaruhi registri', () => {
    const board = createBoard();
    const definition = { id: 'contoh.a', label: 'a', run: () => {} };
    board.commands.register(definition);
    definition.label = 'diubah';
    expect(board.commands.get('contoh.a')?.label).toBe('a');
  });

  it('error dari run dan isEnabled diteruskan ke pemanggil', () => {
    const board = createBoard();
    board.commands.register({
      id: 'contoh.gagal',
      label: 'gagal',
      run: () => {
        throw new Error('run gagal');
      },
    });
    board.commands.register({
      id: 'contoh.cek-gagal',
      label: 'cek',
      isEnabled: () => {
        throw new Error('cek gagal');
      },
      run: () => {},
    });
    expect(() => board.run('contoh.gagal')).toThrow('run gagal');
    expect(() => board.run('contoh.cek-gagal')).toThrow('cek gagal');
  });

  it('perintah bisa mengubah dokumen lewat transact dan di-undo sebagai satu langkah', () => {
    const board = createBoard();
    board.commands.register({
      id: 'contoh.ganti-meta',
      label: 'ganti',
      run: (b, args) => {
        b.transact(
          (tx) => {
            const page = tx.get('page:main');
            if (page) tx.put({ ...page, meta: { nilai: args } });
          },
          { label: 'contoh.ganti-meta' },
        );
      },
    });

    board.run('contoh.ganti-meta', 1);
    expect(board.getDocument().records['page:main']?.meta).toEqual({ nilai: 1 });
    expect(board.undo()).toBe(true);
    expect(board.getDocument().records['page:main']?.meta).toEqual({});
  });

  it('registri per board, tanpa state global', () => {
    const a = createBoard();
    const b = createBoard();
    a.commands.register({ id: 'contoh.a', label: 'a', run: () => {} });
    expect(b.commands.has('contoh.a')).toBe(false);
  });

  it('dispose mengosongkan registri dan board.run melempar', () => {
    const board = createBoard();
    board.commands.register({ id: 'contoh.a', label: 'a', run: () => {} });
    board.dispose();
    expect(board.commands.list()).toHaveLength(0);
    expect(() => board.run('contoh.a')).toThrow('dispose');
  });
});
