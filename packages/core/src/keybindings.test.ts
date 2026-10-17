import { describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineCommand,
  definePlugin,
  defineTool,
  type Board,
  type CreateBoardOptions,
  type InputModifiers,
  type ToolKeyEvent,
} from './index.js';

const NO_MODS: InputModifiers = { shift: false, alt: false, ctrl: false, meta: false };

function keyDown(
  key: string,
  code: string,
  mods: Partial<InputModifiers> = {},
  extra: Partial<ToolKeyEvent> = {},
): ToolKeyEvent {
  return {
    type: 'key-down',
    key,
    code,
    repeat: false,
    modifiers: { ...NO_MODS, ...mods },
    ...extra,
  };
}

/** Tool that stays busy between pointer-down and pointer-up, and records keys it receives. */
function recordingTool(id: string, keys: string[]) {
  return defineTool({
    id,
    initial: 'idle',
    states: {
      idle: {
        onPointerDown: () => 'busy',
        onKeyDown: (_ctx, e) => {
          keys.push(`${id}:${(e as ToolKeyEvent).key}`);
        },
      },
      busy: {
        onPointerUp: () => 'idle',
        onKeyDown: (_ctx, e) => {
          keys.push(`${id}:busy:${(e as ToolKeyEvent).key}`);
        },
      },
    },
  });
}

function setup(options: Partial<CreateBoardOptions> = {}, enabled = { value: true }) {
  const runs: string[] = [];
  const keys: string[] = [];
  const command = (id: string) =>
    defineCommand({ id, label: id, isEnabled: () => enabled.value, run: () => runs.push(id) });
  const plugin = definePlugin({
    id: 'kit',
    tools: [recordingTool('select', keys), recordingTool('hand', keys)],
    commands: [
      command('element.duplicate'),
      command('element.delete'),
      command('layer.bring-forward'),
      command('camera.zoom-to-fit'),
      command('kit.other'),
    ],
    keybindings: {
      'Mod+D': 'element.duplicate',
      Delete: 'element.delete',
      Backspace: 'element.delete',
      'Mod+]': 'layer.bring-forward',
      'Shift+1': 'camera.zoom-to-fit',
      h: 'tool:hand',
      v: 'tool:select',
    },
  });
  const board = createBoard({
    platform: 'other',
    ...options,
    plugins: [plugin, ...(options.plugins ?? [])],
  });
  return { board, runs, keys };
}

function pointer(board: Board, type: 'pointer-down' | 'pointer-up'): void {
  board.dispatch({
    type,
    pointerId: 1,
    pointerType: 'mouse',
    point: { x: 0, y: 0 },
    screen: { x: 0, y: 0 },
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    button: 0,
    buttons: type === 'pointer-down' ? 1 : 0,
    modifiers: NO_MODS,
  });
}

describe('BOARD-504: rebindable keybindings', () => {
  it('runs commands and activates tools from plugin keybindings', () => {
    const { board, runs } = setup();
    expect(board.dispatch(keyDown('d', 'KeyD', { ctrl: true }))).toBe(true);
    expect(board.dispatch(keyDown('Delete', 'Delete'))).toBe(true);
    expect(board.dispatch(keyDown('Backspace', 'Backspace'))).toBe(true);
    expect(runs).toEqual(['element.duplicate', 'element.delete', 'element.delete']);

    // Works with no active tool: the board starts without one.
    expect(board.tool).toBeNull();
    expect(board.dispatch(keyDown('h', 'KeyH'))).toBe(true);
    expect(board.tool).toBe('hand');
    // Shift+V is a different chord: it goes to the active tool instead.
    board.dispatch(keyDown('V', 'KeyV', { shift: true }));
    expect(board.tool).toBe('hand');
    // Caps Lock: an uppercase letter without Shift still matches.
    expect(board.dispatch(keyDown('V', 'KeyV'))).toBe(true);
    expect(board.tool).toBe('select');
  });

  it('resolves Mod to Cmd on macOS and Ctrl elsewhere, with exact modifiers', () => {
    const mac = setup({ platform: 'mac' });
    expect(mac.board.dispatch(keyDown('d', 'KeyD', { ctrl: true }))).toBe(false);
    expect(mac.board.dispatch(keyDown('d', 'KeyD', { meta: true }))).toBe(true);
    expect(mac.board.dispatch(keyDown('D', 'KeyD', { meta: true, shift: true }))).toBe(false);
    expect(mac.runs).toEqual(['element.duplicate']);

    const other = setup({ platform: 'other' });
    expect(other.board.dispatch(keyDown('d', 'KeyD', { meta: true }))).toBe(false);
    expect(other.board.dispatch(keyDown('d', 'KeyD', { ctrl: true }))).toBe(true);
    expect(other.board.keybindings.platform).toBe('other');
  });

  it('matches keys whose character changes with layout or modifiers by their physical code', () => {
    const { board, runs } = setup();
    // Shift+1 produces "!" on US layouts.
    expect(board.dispatch(keyDown('!', 'Digit1', { shift: true }))).toBe(true);
    // Some layouts produce another character for Ctrl+].
    expect(board.dispatch(keyDown('+', 'BracketRight', { ctrl: true }))).toBe(true);
    // Alt on macOS turns letters into symbols; the physical key still counts.
    const mac = setup({ platform: 'mac', keybindings: { 'Alt+K': 'kit.other' } });
    expect(mac.board.dispatch(keyDown('˚', 'KeyK', { alt: true }))).toBe(true);
    expect(runs).toEqual(['camera.zoom-to-fit', 'layer.bring-forward']);
    expect(mac.runs).toEqual(['kit.other']);
  });

  it('lets consumer keybindings win over plugins, and null removes a plugin shortcut', () => {
    const { board, runs } = setup({
      keybindings: { 'Ctrl+D': 'kit.other', Backspace: null, 'Mod+K': 'element.duplicate' },
    });
    board.dispatch(keyDown('d', 'KeyD', { ctrl: true }));
    expect(board.dispatch(keyDown('Backspace', 'Backspace'))).toBe(false);
    board.dispatch(keyDown('k', 'KeyK', { ctrl: true }));
    expect(runs).toEqual(['kit.other', 'element.duplicate']);

    expect(board.keybindings.get('Mod+D')).toMatchObject({ target: 'kit.other', source: 'user' });
    expect(board.keybindings.get('Backspace')).toBeUndefined();
    expect(board.keybindings.get('Delete')).toMatchObject({
      target: 'element.delete',
      source: 'kit',
    });
    expect(board.keybindings.forTarget('element.duplicate').map((b) => b.shortcut)).toEqual([
      'Mod+K',
    ]);
  });

  it('a later plugin wins over an earlier one', () => {
    const later = definePlugin({ id: 'later', keybindings: { 'Mod+D': 'kit.other' } });
    const { board, runs } = setup({ plugins: [later] });
    board.dispatch(keyDown('d', 'KeyD', { ctrl: true }));
    expect(runs).toEqual(['kit.other']);
    expect(board.keybindings.get('Ctrl+D')?.source).toBe('later');
  });

  it('can be rebound at runtime with keybindings.set', () => {
    const { board, runs } = setup();
    board.keybindings.set('Mod+D', null);
    board.keybindings.set('Shift+Mod+D', 'element.duplicate');
    expect(board.dispatch(keyDown('d', 'KeyD', { ctrl: true }))).toBe(false);
    expect(board.dispatch(keyDown('D', 'KeyD', { ctrl: true, shift: true }))).toBe(true);
    expect(runs).toEqual(['element.duplicate']);
    expect(() => board.keybindings.set('Mod+Nope', 'x')).toThrow(TypeError);
    expect(() => board.keybindings.set('Mod+D', '  ')).toThrow(TypeError);
  });

  it('is not handled when the command is disabled, unknown, or the key repeats', () => {
    const enabled = { value: false };
    const { board, runs } = setup(
      { keybindings: { 'Mod+U': 'missing.command', u: 'tool:missing' } },
      enabled,
    );
    expect(board.dispatch(keyDown('d', 'KeyD', { ctrl: true }))).toBe(false);
    expect(board.dispatch(keyDown('u', 'KeyU', { ctrl: true }))).toBe(false);
    expect(board.dispatch(keyDown('u', 'KeyU'))).toBe(false);
    enabled.value = true;
    expect(board.dispatch(keyDown('d', 'KeyD', { ctrl: true }, { repeat: true }))).toBe(false);
    expect(runs).toEqual([]);
  });

  it('ignores keys typed into text inputs, except Escape', () => {
    const { board, runs, keys } = setup();
    board.setTool('hand');
    expect(board.dispatch(keyDown('d', 'KeyD', { ctrl: true }, { inTextInput: true }))).toBe(false);
    expect(board.dispatch(keyDown('v', 'KeyV', {}, { inTextInput: true }))).toBe(false);
    expect(board.tool).toBe('hand');
    expect(runs).toEqual([]);
    expect(keys).toEqual([]);
    // Escape still works: it switches back to the default tool.
    expect(board.dispatch(keyDown('Escape', 'Escape', {}, { inTextInput: true }))).toBe(true);
    expect(board.tool).toBe('select');
  });

  it('sends keys only to the tool during an interaction, so shortcuts cannot interfere', () => {
    const { board, runs, keys } = setup();
    board.setTool('select');
    pointer(board, 'pointer-down');
    expect(board.toolState).toBe('busy');
    board.dispatch(keyDown('d', 'KeyD', { ctrl: true }));
    board.dispatch(keyDown('h', 'KeyH'));
    expect(runs).toEqual([]);
    expect(board.tool).toBe('select');
    expect(keys).toEqual(['select:busy:d', 'select:busy:h']);
    pointer(board, 'pointer-up');

    // Idle again: unbound keys still reach the tool, bound keys run the shortcut.
    board.dispatch(keyDown('x', 'KeyX'));
    board.dispatch(keyDown('d', 'KeyD', { ctrl: true }));
    expect(keys).toEqual(['select:busy:d', 'select:busy:h', 'select:x']);
    expect(runs).toEqual(['element.duplicate']);
  });

  it('formats shortcuts per platform', () => {
    const mac = setup({ platform: 'mac' }).board.keybindings;
    expect(mac.format('Shift+Mod+L')).toBe('⇧⌘L');
    expect(mac.format('Mod+]')).toBe('⌘]');
    expect(mac.format('Backspace')).toBe('⌫');
    const other = setup({ platform: 'other' }).board.keybindings;
    expect(other.format('Shift+Mod+L')).toBe('Ctrl+Shift+L');
    expect(other.format('Mod++')).toBe('Ctrl++');
  });

  it('accepts modifier aliases case-insensitively and rejects invalid notation', () => {
    const { board } = setup({
      keybindings: { 'control+option+esc': 'kit.other', 'CMD+Plus': 'kit.other' },
    });
    expect(board.keybindings.get('Ctrl+Alt+Escape')?.target).toBe('kit.other');
    expect(board.keybindings.get('Meta++')?.target).toBe('kit.other');
    expect(() => setup({ keybindings: { 'Hyper+K': 'x' } })).toThrow(TypeError);
    expect(() => setup({ keybindings: { k: 42 as never } })).toThrow(TypeError);
  });

  it('detects the platform from navigator', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    try {
      const board = createBoard();
      expect(board.keybindings.platform).toBe('mac');
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('navigator', { userAgentData: { platform: 'Windows' } });
    try {
      expect(createBoard().keybindings.platform).toBe('other');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
