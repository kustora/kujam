/**
 * Rebindable keyboard shortcuts (BOARD-504).
 *
 * A shortcut maps a key chord to a target: a command ID (run with `board.run`) or `'tool:<id>'`
 * (activates a tool). Plugins contribute `keybindings`, and the consumer's
 * `createBoard({ keybindings })` (or {@link BoardKeybindings.set}) wins on conflict.
 *
 * Notation: modifiers and one key joined by `+`, for example `'Mod+D'`, `'Shift+Mod+L'`, `'Delete'`,
 * `'h'`, or `'Shift+1'`. `Mod` is Cmd on macOS and Ctrl elsewhere. Modifier names are
 * case-insensitive: `Mod`, `Ctrl`/`Control`, `Cmd`/`Command`/`Meta`, `Alt`/`Option`, `Shift`.
 * Modifiers must match exactly, so `'Mod+D'` does not fire for Shift+Mod+D.
 */

import type { ToolKeyEvent } from './tools.js';

/**
 * Keyboard platform that decides what `Mod` means: Cmd (`meta`) on `'mac'`, Ctrl elsewhere.
 *
 * @beta
 */
export type KeyboardPlatform = 'mac' | 'other';

/**
 * One effective shortcut.
 *
 * @beta
 */
export interface Keybinding {
  /** The shortcut as written, for example `'Mod+]'`. */
  readonly shortcut: string;
  /** Platform-resolved chord used to detect conflicts, for example `'Meta+]'` on macOS. */
  readonly chord: string;
  /** Command ID, or `'tool:<id>'` to activate a tool. */
  readonly target: string;
  /** ID of the plugin that declared it, or `'user'` for consumer bindings. */
  readonly source: string;
}

/**
 * Shortcut map of one board (`board.keybindings`).
 *
 * @beta
 */
export interface BoardKeybindings {
  /** Platform used to resolve `Mod`. */
  readonly platform: KeyboardPlatform;
  /** Effective shortcuts: plugin bindings overridden by consumer bindings. */
  list(): readonly Keybinding[];
  /** Effective shortcut for a chord in any notation, or `undefined`. */
  get(shortcut: string): Keybinding | undefined;
  /** Effective shortcuts that trigger `target`, for tooltips and the command palette. */
  forTarget(target: string): readonly Keybinding[];
  /**
   * Binds a shortcut on the consumer layer, which wins over plugin bindings. `null` removes the
   * shortcut, including a plugin's binding for the same chord.
   *
   * @throws `TypeError` when the shortcut notation or target is invalid.
   */
  set(shortcut: string, target: string | null): void;
  /** The shortcut a key event triggers, or `undefined`. Does not run anything. */
  match(event: ToolKeyEvent): Keybinding | undefined;
  /** Display label for the platform, for example `'⇧⌘L'` on macOS and `'Ctrl+Shift+L'` elsewhere. */
  format(shortcut: string): string;
}

interface Chord {
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  /** Lowercase letter, digit, a single symbol, or a named key such as `'Delete'`. */
  readonly key: string;
}

const NAMED_KEYS = [
  'Escape',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
];

const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'Escape',
  del: 'Delete',
  return: 'Enter',
  plus: '+',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

/** `KeyboardEvent.code` of symbols, used when the layout or a modifier changes `event.key`. */
const SYMBOL_CODES: Readonly<Record<string, string>> = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '=': 'Equal',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  '`': 'Backquote',
};

const MODIFIERS: Readonly<Record<string, 'mod' | 'ctrl' | 'meta' | 'alt' | 'shift'>> = {
  mod: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

function normalizeKey(token: string): string | undefined {
  if (token.length === 1) return token.toLowerCase();
  const lower = token.toLowerCase();
  if (Object.hasOwn(KEY_ALIASES, lower)) return KEY_ALIASES[lower];
  return NAMED_KEYS.find((name) => name.toLowerCase() === lower);
}

/**
 * Parses a shortcut into a platform-resolved chord.
 *
 * @throws `TypeError` when the notation is invalid.
 * @internal
 */
export function parseShortcut(shortcut: string, platform: KeyboardPlatform): Chord {
  if (typeof shortcut !== 'string' || shortcut.trim().length === 0) {
    throw new TypeError('Shortcut wajib berupa string tidak kosong.');
  }
  const text = shortcut.trim();
  // A trailing `++` means the key itself is `+`, for example `'Mod++'`.
  const parts = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+');
  const keyToken = parts.pop()!.trim();
  const key = normalizeKey(keyToken);
  if (key === undefined || keyToken.length === 0) {
    throw new TypeError(`Shortcut "${shortcut}" memakai tombol "${keyToken}" yang tidak dikenal.`);
  }
  const flags = { ctrl: false, meta: false, alt: false, shift: false };
  for (const raw of parts) {
    const name = raw.trim().toLowerCase();
    const modifier = Object.hasOwn(MODIFIERS, name) ? MODIFIERS[name] : undefined;
    if (modifier === undefined) {
      throw new TypeError(`Shortcut "${shortcut}" memakai modifier "${raw}" yang tidak dikenal.`);
    }
    if (modifier === 'mod') flags[platform === 'mac' ? 'meta' : 'ctrl'] = true;
    else flags[modifier] = true;
  }
  return { ...flags, key };
}

function chordId(chord: Chord): string {
  const mods = [
    chord.ctrl && 'Ctrl',
    chord.meta && 'Meta',
    chord.alt && 'Alt',
    chord.shift && 'Shift',
  ].filter(Boolean);
  return [...mods, chord.key].join('+');
}

/** Whether `event` presses the chord's key, independent of modifiers. */
function keyMatches(chord: Chord, event: ToolKeyEvent): 'key' | 'code' | false {
  const { key } = chord;
  if (/^[a-z]$/.test(key)) {
    if (event.key.toLowerCase() === key) return 'key';
    // A modifier (for example Alt on macOS) can turn the letter into another character.
    return !/^[a-z]$/i.test(event.key) && event.code === `Key${key.toUpperCase()}` ? 'code' : false;
  }
  if (/^[0-9]$/.test(key)) {
    if (event.key === key) return 'key';
    // Shift+1 produces `'!'` on US layouts; the physical key still reports `Digit1`.
    return event.code === `Digit${key}` ? 'code' : false;
  }
  if (key.length === 1) {
    if (event.key === key) return 'key';
    return Object.hasOwn(SYMBOL_CODES, key) && event.code === SYMBOL_CODES[key] ? 'code' : false;
  }
  if (key === 'Space') return event.code === 'Space' || event.key === ' ' ? 'key' : false;
  return event.key === key ? 'key' : false;
}

function eventMatches(chord: Chord, event: ToolKeyEvent): boolean {
  const how = keyMatches(chord, event);
  if (!how) return false;
  const m = event.modifiers;
  if (m.ctrl !== chord.ctrl || m.meta !== chord.meta || m.alt !== chord.alt) return false;
  // A symbol matched by `event.key` may need Shift on some layouts (for example `?`), so Shift is
  // only compared for letters, digits, named keys, and symbols matched by their physical key.
  const symbolByKey = how === 'key' && chord.key.length === 1 && !/^[a-z0-9]$/.test(chord.key);
  return symbolByKey || m.shift === chord.shift;
}

/**
 * Detects the platform from `globalThis.navigator` when available. Core has no DOM types, so the
 * lookup is defensive; anything that is not Apple counts as `'other'`.
 *
 * @internal
 */
export function detectPlatform(): KeyboardPlatform {
  const nav = (
    globalThis as {
      navigator?: { platform?: unknown; userAgentData?: { platform?: unknown } };
    }
  ).navigator;
  const platform = nav?.userAgentData?.platform ?? nav?.platform;
  return typeof platform === 'string' && /mac|iphone|ipad|ipod|darwin/i.test(platform)
    ? 'mac'
    : 'other';
}

/**
 * Validates a keybinding map (plugin or consumer). Returns error messages; empty means valid.
 *
 * @internal
 */
export function checkKeybindingMap(map: unknown, label: string, allowNull: boolean): string[] {
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    return [`${label} wajib berupa objek { [shortcut]: target }.`];
  }
  const errors: string[] = [];
  for (const [shortcut, target] of Object.entries(map)) {
    try {
      parseShortcut(shortcut, 'other');
    } catch (error) {
      errors.push(`${label}: ${(error as Error).message}`);
    }
    const nullOk = allowNull && target === null;
    if (!nullOk && (typeof target !== 'string' || target.trim().length === 0)) {
      errors.push(
        `${label}["${shortcut}"] wajib berupa string target tidak kosong${allowNull ? ' atau null' : ''}.`,
      );
    }
  }
  return errors;
}

const MAC_SYMBOLS: Readonly<Record<string, string>> = {
  Escape: '⎋',
  Enter: '↩',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** @internal */
export interface KeymapRuntime {
  readonly api: BoardKeybindings;
  /** Replaces the plugin layer, in plugin installation order (later plugins win). */
  loadPlugins(
    plugins: readonly { id: string; keybindings?: Readonly<Record<string, string>> }[],
  ): void;
}

/** @internal */
export function createKeymap(
  platform: KeyboardPlatform,
  user: Readonly<Record<string, string | null>> | undefined,
): KeymapRuntime {
  const errors = user === undefined ? [] : checkKeybindingMap(user, 'Opsi keybindings', true);
  if (errors.length > 0) throw new TypeError(errors.join(' '));

  interface Entry {
    readonly binding: Keybinding;
    readonly chord: Chord;
    readonly fromUser: boolean;
  }
  const pluginLayer = new Map<string, Entry>();
  /** `null` removes the chord, including a plugin binding. */
  const userLayer = new Map<string, Entry | null>();

  function entry(shortcut: string, target: string, source: string, fromUserLayer = false): Entry {
    const chord = parseShortcut(shortcut, platform);
    return {
      chord,
      binding: Object.freeze({ shortcut: shortcut.trim(), chord: chordId(chord), target, source }),
      fromUser: fromUserLayer,
    };
  }

  function setUser(shortcut: string, target: string | null): void {
    const chord = chordId(parseShortcut(shortcut, platform));
    userLayer.set(chord, target === null ? null : entry(shortcut, target, 'user', true));
  }

  for (const [shortcut, target] of Object.entries(user ?? {})) setUser(shortcut, target);

  function effective(): Entry[] {
    const out: Entry[] = [];
    for (const [chord, e] of pluginLayer) {
      if (!userLayer.has(chord)) out.push(e);
    }
    for (const e of userLayer.values()) if (e) out.push(e);
    return out;
  }

  function lookup(chord: string): Entry | undefined {
    if (userLayer.has(chord)) return userLayer.get(chord) ?? undefined;
    return pluginLayer.get(chord);
  }

  const api: BoardKeybindings = {
    platform,
    list: () => Object.freeze(effective().map((e) => e.binding)),
    get: (shortcut) => lookup(chordId(parseShortcut(shortcut, platform)))?.binding,
    forTarget: (target) =>
      Object.freeze(
        effective()
          .filter((e) => e.binding.target === target)
          .map((e) => e.binding),
      ),
    set(shortcut, target) {
      if (target !== null && (typeof target !== 'string' || target.trim().length === 0)) {
        throw new TypeError('Target keybinding wajib berupa string tidak kosong atau null.');
      }
      setUser(shortcut, target);
    },
    match(event) {
      if (event.type !== 'key-down') return undefined;
      // Consumer bindings first: when two chords match one event (for example a symbol matched
      // with and without Shift), the consumer's binding wins.
      const ordered = effective().sort((a, b) => Number(b.fromUser) - Number(a.fromUser));
      return ordered.find((e) => eventMatches(e.chord, event))?.binding;
    },
    format(shortcut) {
      const c = parseShortcut(shortcut, platform);
      const key = c.key.length === 1 ? c.key.toUpperCase() : c.key;
      if (platform === 'mac') {
        const mods = `${c.ctrl ? '⌃' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.meta ? '⌘' : ''}`;
        return mods + (Object.hasOwn(MAC_SYMBOLS, key) ? MAC_SYMBOLS[key] : key);
      }
      const mods = [c.ctrl && 'Ctrl', c.meta && 'Meta', c.alt && 'Alt', c.shift && 'Shift'];
      return [...mods.filter(Boolean), key].join('+');
    },
  };

  return {
    api,
    loadPlugins(plugins) {
      pluginLayer.clear();
      for (const plugin of plugins) {
        for (const [shortcut, target] of Object.entries(plugin.keybindings ?? {})) {
          const e = entry(shortcut, target, plugin.id);
          // Re-insert so a later plugin's binding also takes the later position.
          pluginLayer.delete(e.binding.chord);
          pluginLayer.set(e.binding.chord, e);
        }
      }
    },
  };
}
