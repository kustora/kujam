/**
 * Context menu definitions and builder for element actions and common commands (BOARD-912).
 */

import type { Point } from '../geometry/geometry.js';
import type { Board } from '../index.js';
import { parseClipboard, serializeClipboard, type ClipboardPayload } from '../clipboard/clipboard.js';
import { insertContent } from '../clipboard/clipboard.js';

interface GlobalWithNavigator {
  navigator?: {
    clipboard?: {
      writeText?(text: string): Promise<void>;
      readText?(): Promise<string>;
    };
  };
}

/** In-memory clipboard store for fallback copy/paste within the page session. */
let inMemoryClipboard: ClipboardPayload | null = null;

/**
 * Gets the current in-memory clipboard payload (BOARD-912).
 *
 * @internal
 */
export function getInMemoryClipboard(): ClipboardPayload | null {
  return inMemoryClipboard;
}

/**
 * Sets the in-memory clipboard payload (BOARD-912).
 *
 * @internal
 */
export function setInMemoryClipboard(payload: ClipboardPayload | null): void {
  inMemoryClipboard = payload;
}

/**
 * Single item or separator in the whiteboard context menu (BOARD-912).
 *
 * @public
 */
export interface ContextMenuItem {
  /** Unique ID of the menu item. */
  readonly id: string;
  /** Label to display in the menu. */
  readonly label: string;
  /** Formatted keyboard shortcut (e.g. 'Mod+C'). */
  readonly shortcut?: string;
  /** Optional icon name matching UI icons. */
  readonly icon?: string;
  /** Whether the item is disabled. */
  readonly disabled?: boolean;
  /** Whether the item is checked (e.g. for toggleable actions). */
  readonly checked?: boolean;
  /** Whether the item performs a destructive action (e.g. delete). */
  readonly danger?: boolean;
  /** Whether this item is a visual separator divider. */
  readonly separator?: boolean;
  /** Submenu items if this is a nested menu. */
  readonly items?: readonly ContextMenuItem[];
  /** Executes the item's action. */
  run(): void;
}

/**
 * Payload of the `contextmenu` event (BOARD-912).
 *
 * @public
 */
export interface ContextMenuEvent {
  /** Screen position relative to the board view root. */
  readonly screen: Point;
  /** Point in board canvas coordinates. */
  readonly point: Point;
  /** Position in client viewport coordinates (e.g. for positioning overlays). */
  readonly client: Point;
  /** Hit element ID under pointer, or `null` when clicked on canvas background. */
  readonly targetId: string | null;
  /** Element IDs selected / targeted by this menu context. */
  readonly targets: readonly string[];
  /** Menu items computed from commands and element actions. */
  readonly items: readonly ContextMenuItem[];
  /** Prevents the default UI context menu overlay from opening. */
  preventDefault(): void;
  /** Whether preventDefault was called. */
  readonly defaultPrevented: boolean;
}

/**
 * Options for {@link buildContextMenuItems}.
 *
 * @public
 */
export interface BuildContextMenuOptions {
  /** Element ID that was hit under the pointer, or null if on empty canvas. */
  readonly targetId?: string | null;
  /** Board coordinates where the context menu was triggered. */
  readonly point?: Point;
}

/**
 * Builds the context menu items for the current board state (BOARD-912).
 *
 * - When elements are selected: element actions from `board.getActions()`, clipboard commands,
 *   layer order, grouping, locking, and delete.
 * - When canvas background is clicked (no selection): paste, select all, undo, redo, and zoom options.
 *
 * @param board - Board instance to query.
 * @param options - Hit target and board point coordinates.
 * @returns Immutable array of {@link ContextMenuItem}.
 * @public
 */
export function buildContextMenuItems(
  board: Board,
  options: BuildContextMenuOptions = {},
): readonly ContextMenuItem[] {
  const { targetId = null, point } = options;
  const targets = board.selection.slice();
  const unlocked = targets.filter((id) => !board.getElement(id)?.locked);

  function shortcutFor(cmdId: string, fallback?: string): string | undefined {
    const binding = board.keybindings.forTarget(cmdId)[0];
    if (binding) return board.keybindings.format(binding.shortcut);
    return fallback ? board.keybindings.format(fallback) : undefined;
  }

  const items: ContextMenuItem[] = [];

  const addSeparator = (): void => {
    if (items.length > 0 && !items[items.length - 1]?.separator) {
      items.push({
        id: `sep-${items.length}`,
        label: '',
        separator: true,
        run: () => {},
      });
    }
  };

  const copyToClipboard = (): void => {
    const payload = serializeClipboard(board);
    if (!payload) return;
    inMemoryClipboard = payload;
    const nav = (globalThis as GlobalWithNavigator).navigator;
    if (nav?.clipboard?.writeText) {
      nav.clipboard.writeText(payload.text || payload.json).catch(() => {});
    }
  };

  const pasteFromClipboard = (): void => {
    const atPoint = point ?? board.camera.screenToBoard({
      x: board.camera.viewport.width / 2,
      y: board.camera.viewport.height / 2,
    });

    if (inMemoryClipboard) {
      const doc = parseClipboard(inMemoryClipboard.json);
      if (doc) {
        const result = insertContent(board, doc, { at: atPoint });
        board.select(result.rootIds);
        return;
      }
    }

    const nav = (globalThis as GlobalWithNavigator).navigator;
    if (nav?.clipboard?.readText) {
      nav.clipboard.readText().then((text: string) => {
        const doc = parseClipboard(text);
        if (doc) {
          const result = insertContent(board, doc, { at: atPoint });
          board.select(result.rootIds);
        }
      }).catch(() => {});
    }
  };

  // Case 1: Selection is not empty (element context menu)
  if (targets.length > 0) {
    // 1. Element custom actions from board.getActions()
    const actions = board.getActions(targets);
    const executeAction = (action: { id: string; run: () => void }): void => {
      const lone = targets.length === 1 ? board.getElement(targets[0]!) : undefined;
      if (lone && typeof board.runAction === 'function') {
        board.runAction(action as never, lone);
      } else {
        action.run();
      }
    };

    for (const action of actions) {
      if ('items' in action && Array.isArray(action.items)) {
        const subitems: ContextMenuItem[] = action.items.map((sub) => ({
          id: sub.id,
          label: sub.label,
          icon: sub.icon,
          disabled: typeof sub.isEnabled === 'function' ? !sub.isEnabled() : false,
          checked: typeof sub.isActive === 'function' ? sub.isActive() : Boolean((sub as { checked?: boolean }).checked),
          run: () => executeAction(sub),
        }));
        items.push({
          id: action.id,
          label: action.label,
          items: Object.freeze(subitems),
          run: () => {},
        });
      } else {
        items.push({
          id: action.id,
          label: action.label,
          icon: action.icon,
          disabled: typeof action.isEnabled === 'function' ? !action.isEnabled() : false,
          checked: typeof action.isActive === 'function' ? action.isActive() : Boolean((action as { checked?: boolean }).checked),
          run: () => executeAction(action),
        });
      }
    }

    addSeparator();

    // 2. Clipboard & Duplicate
    items.push({
      id: 'clipboard.cut',
      label: board.i18n.t('clipboard.cut'),
      shortcut: shortcutFor('clipboard.cut', 'Mod+X'),
      disabled: board.readOnly || unlocked.length === 0,
      run: () => {
        copyToClipboard();
        board.delete(unlocked, { label: 'clipboard.cut' });
      },
    });

    items.push({
      id: 'clipboard.copy',
      label: board.i18n.t('clipboard.copy'),
      shortcut: shortcutFor('clipboard.copy', 'Mod+C'),
      disabled: targets.length === 0,
      run: copyToClipboard,
    });

    items.push({
      id: 'clipboard.paste',
      label: board.i18n.t('clipboard.paste'),
      shortcut: shortcutFor('clipboard.paste', 'Mod+V'),
      disabled: board.readOnly,
      run: pasteFromClipboard,
    });

    items.push({
      id: 'element.duplicate',
      label: board.i18n.t('duplicate'),
      shortcut: shortcutFor('element.duplicate', 'Mod+D'),
      disabled: board.readOnly || unlocked.length === 0 || !board.commands.isEnabled('element.duplicate'),
      run: () => board.run('element.duplicate'),
    });

    addSeparator();

    // 3. Grouping & Layer order
    if (board.commands.has('container.group') && targets.length > 1) {
      items.push({
        id: 'container.group',
        label: board.i18n.t('group'),
        shortcut: shortcutFor('container.group', 'Mod+G'),
        disabled: board.readOnly || !board.commands.isEnabled('container.group'),
        run: () => board.run('container.group'),
      });
    }

    if (board.commands.has('container.ungroup') && targets.some((id) => board.getElement(id)?.type === 'group')) {
      items.push({
        id: 'container.ungroup',
        label: board.i18n.t('ungroup'),
        shortcut: shortcutFor('container.ungroup', 'Mod+Shift+G'),
        disabled: board.readOnly || !board.commands.isEnabled('container.ungroup'),
        run: () => board.run('container.ungroup'),
      });
    }

    if (board.commands.has('layer.bring-forward')) {
      items.push({
        id: 'layer.bring-forward',
        label: board.i18n.t('layer.bringForward'),
        shortcut: shortcutFor('layer.bring-forward', 'Mod+]'),
        disabled: board.readOnly || !board.commands.isEnabled('layer.bring-forward'),
        run: () => board.run('layer.bring-forward'),
      });
    }

    if (board.commands.has('layer.send-backward')) {
      items.push({
        id: 'layer.send-backward',
        label: board.i18n.t('layer.sendBackward'),
        shortcut: shortcutFor('layer.send-backward', 'Mod+['),
        disabled: board.readOnly || !board.commands.isEnabled('layer.send-backward'),
        run: () => board.run('layer.send-backward'),
      });
    }

    if (board.commands.has('layer.bring-to-front')) {
      items.push({
        id: 'layer.bring-to-front',
        label: board.i18n.t('layer.bringToFront'),
        shortcut: shortcutFor('layer.bring-to-front', 'Mod+Shift+]'),
        disabled: board.readOnly || !board.commands.isEnabled('layer.bring-to-front'),
        run: () => board.run('layer.bring-to-front'),
      });
    }

    if (board.commands.has('layer.send-to-back')) {
      items.push({
        id: 'layer.send-to-back',
        label: board.i18n.t('layer.sendToBack'),
        shortcut: shortcutFor('layer.send-to-back', 'Mod+Shift+['),
        disabled: board.readOnly || !board.commands.isEnabled('layer.send-to-back'),
        run: () => board.run('layer.send-to-back'),
      });
    }

    addSeparator();

    // 4. Lock / Unlock
    const allLocked = targets.every((id) => board.getElement(id)?.locked);
    if (allLocked) {
      items.push({
        id: 'element.unlock',
        label: board.i18n.t('unlock'),
        shortcut: shortcutFor('element.unlock', 'Mod+Shift+L'),
        disabled: board.readOnly || !board.commands.isEnabled('element.unlock'),
        run: () => board.run('element.unlock'),
      });
    } else {
      items.push({
        id: 'element.lock',
        label: board.i18n.t('lock'),
        shortcut: shortcutFor('element.lock', 'Mod+Shift+L'),
        disabled: board.readOnly || !board.commands.isEnabled('element.lock'),
        run: () => board.run('element.lock'),
      });
    }

    addSeparator();

    // 5. Delete
    items.push({
      id: 'element.delete',
      label: board.i18n.t('delete'),
      shortcut: shortcutFor('element.delete', 'Backspace'),
      danger: true,
      disabled: board.readOnly || unlocked.length === 0 || !board.commands.isEnabled('element.delete'),
      run: () => board.run('element.delete'),
    });
  } else {
    // Case 2: Empty canvas (no selection)
    items.push({
      id: 'clipboard.paste',
      label: board.i18n.t('clipboard.paste'),
      shortcut: shortcutFor('clipboard.paste', 'Mod+V'),
      disabled: board.readOnly,
      run: pasteFromClipboard,
    });

    if (board.commands.has('selection.all')) {
      items.push({
        id: 'selection.all',
        label: board.i18n.t('command.selection.all'),
        shortcut: shortcutFor('selection.all', 'Mod+A'),
        disabled: board.query().length === 0 || !board.commands.isEnabled('selection.all'),
        run: () => board.run('selection.all'),
      });
    }

    addSeparator();

    if (board.commands.has('history.undo')) {
      items.push({
        id: 'history.undo',
        label: board.i18n.t('undo'),
        shortcut: shortcutFor('history.undo', 'Mod+Z'),
        disabled: !board.history.canUndo || !board.commands.isEnabled('history.undo'),
        run: () => board.run('history.undo'),
      });
    }

    if (board.commands.has('history.redo')) {
      items.push({
        id: 'history.redo',
        label: board.i18n.t('redo'),
        shortcut: shortcutFor('history.redo', 'Mod+Shift+Z'),
        disabled: !board.history.canRedo || !board.commands.isEnabled('history.redo'),
        run: () => board.run('history.redo'),
      });
    }

    addSeparator();

    if (board.commands.has('camera.zoom-to-fit')) {
      items.push({
        id: 'camera.zoom-to-fit',
        label: board.i18n.t('zoomToFit'),
        shortcut: shortcutFor('camera.zoom-to-fit', 'Shift+1'),
        disabled: !board.commands.isEnabled('camera.zoom-to-fit'),
        run: () => board.run('camera.zoom-to-fit'),
      });
    }

    if (board.commands.has('camera.zoom-reset')) {
      items.push({
        id: 'camera.zoom-reset',
        label: board.i18n.t('command.camera.zoom-reset'),
        shortcut: shortcutFor('camera.zoom-reset', 'Shift+0'),
        disabled: !board.commands.isEnabled('camera.zoom-reset'),
        run: () => board.run('camera.zoom-reset'),
      });
    }
  }

  // Remove trailing separator if any
  while (items.length > 0 && items[items.length - 1]?.separator) {
    items.pop();
  }

  return Object.freeze(items);
}

/**
 * Creates a {@link ContextMenuEvent} payload (BOARD-912).
 *
 * @public
 */
export function createContextMenuEvent(options: {
  board: Board;
  screen: Point;
  point: Point;
  client: Point;
  targetId?: string | null;
  items?: readonly ContextMenuItem[];
}): ContextMenuEvent {
  const { board, screen, point, client, targetId = null } = options;
  const items = options.items ?? buildContextMenuItems(board, { targetId, point });
  let prevented = false;

  return {
    screen: Object.freeze({ x: screen.x, y: screen.y }),
    point: Object.freeze({ x: point.x, y: point.y }),
    client: Object.freeze({ x: client.x, y: client.y }),
    targetId,
    targets: Object.freeze(board.selection.slice()),
    items,
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented(): boolean {
      return prevented;
    },
  };
}
