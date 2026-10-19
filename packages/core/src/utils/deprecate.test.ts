import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deprecate, isDevelopmentMode, resetDeprecationWarnings } from './deprecate.js';

describe('BOARD-2301: deprecate(message)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    resetDeprecationWarnings();
    delete (globalThis as { __KUJAM_DEV__?: boolean }).__KUJAM_DEV__;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    resetDeprecationWarnings();
    delete (globalThis as { __KUJAM_DEV__?: boolean }).__KUJAM_DEV__;
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    vi.restoreAllMocks();
  });

  it('mencetak peringatan ke console.warn tepat sekali per pesan unik di mode development', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deprecate('board.oldMethod() digantikan oleh board.newMethod() dan akan dihapus di 0.3.0.');
    deprecate('board.oldMethod() digantikan oleh board.newMethod() dan akan dihapus di 0.3.0.');
    deprecate('board.oldMethod() digantikan oleh board.newMethod() dan akan dihapus di 0.3.0.');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[@kujam] Deprecated: board.oldMethod() digantikan oleh board.newMethod() dan akan dihapus di 0.3.0.',
    );
  });

  it('mencetak peringatan terpisah untuk pesan yang berbeda', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deprecate('API A sudah usang.');
    deprecate('API B sudah usang.');
    deprecate('API A sudah usang.');

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenNthCalledWith(1, '[@kujam] Deprecated: API A sudah usang.');
    expect(warnSpy).toHaveBeenNthCalledWith(2, '[@kujam] Deprecated: API B sudah usang.');
  });

  it('tidak menggandakan prefix bila pesan sudah diawali [@kujam]', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deprecate('[@kujam] Custom deprecation message');
    expect(warnSpy).toHaveBeenCalledWith('[@kujam] Custom deprecation message');
  });

  it('tidak mencetak peringatan di mode production (NODE_ENV === "production")', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NODE_ENV = 'production';

    expect(isDevelopmentMode()).toBe(false);
    deprecate('API yang di-deprecate tidak boleh bocor ke log production.');
    expect(warnSpy).not.toHaveBeenCalled();

    // Switching back to development allows the warning to be emitted once.
    process.env.NODE_ENV = 'development';
    deprecate('API yang di-deprecate tidak boleh bocor ke log production.');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('menghormati override eksplisit globalThis.__KUJAM_DEV__', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    (globalThis as { __KUJAM_DEV__?: boolean }).__KUJAM_DEV__ = false;
    expect(isDevelopmentMode()).toBe(false);
    deprecate('Pesan saat __KUJAM_DEV__ = false');
    expect(warnSpy).not.toHaveBeenCalled();

    process.env.NODE_ENV = 'production';
    (globalThis as { __KUJAM_DEV__?: boolean }).__KUJAM_DEV__ = true;
    expect(isDevelopmentMode()).toBe(true);
    deprecate('Pesan saat __KUJAM_DEV__ = true');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('resetDeprecationWarnings() mengizinkan pesan yang sama dicetak kembali', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    deprecate('Peringatan berulang setelah reset');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    resetDeprecationWarnings();
    deprecate('Peringatan berulang setelah reset');
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('tetap aman dan tidak melempar bila console tidak tersedia atau console.warn melempar', () => {
    const originalConsole = globalThis.console;
    try {
      Object.defineProperty(globalThis, 'console', { value: undefined, configurable: true });
      expect(() => deprecate('Tanpa console')).not.toThrow();

      Object.defineProperty(globalThis, 'console', {
        value: {
          warn() {
            throw new Error('console.warn gagal');
          },
        },
        configurable: true,
      });
      expect(() => deprecate('Console melempar error')).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'console', { value: originalConsole, configurable: true });
    }
  });
});
