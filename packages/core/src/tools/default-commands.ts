/**
 * Built-in commands: layer order, lock, duplicate, delete, select all, and zoom (BOARD-505).
 *
 * Shipped as the {@link defaultCommands} plugin, built only on the public `Board` API like any
 * custom plugin. Each command that changes the document is one undo step, and every command
 * reports itself disabled (`isEnabled`) when it has nothing to act on or the board is read-only.
 */

import { defineCommand, type AnyCommandDefinition } from './commands.js';
import type { Point } from '../geometry/geometry.js';
import type { Board } from '../index.js';
import { compareIndex, indicesBetween } from '../document/indexing.js';
import { definePlugin } from '../plugins/plugins.js';
import type { ElementRecord } from '../types.js';

/**
 * Offset of copies made by `element.duplicate`, in board units.
 *
 * @beta
 */
export const DEFAULT_DUPLICATE_OFFSET: Readonly<Point> = Object.freeze({ x: 16, y: 16 });

/**
 * Arguments of `element.duplicate`.
 *
 * @beta
 */
export interface DuplicateArgs {
  /** Offset of the copies, in board units. Defaults to {@link DEFAULT_DUPLICATE_OFFSET}. */
  readonly offset?: Point;
}

type LayerMode = 'forward' | 'backward' | 'front' | 'back';

function selectedElements(board: Board): Readonly<ElementRecord>[] {
  const out: Readonly<ElementRecord>[] = [];
  for (const id of board.selection) {
    const el = board.getElement(id);
    if (el) out.push(el);
  }
  return out;
}

/** Selected elements that may be changed: locked ones stay where they are. */
function unlockedSelection(board: Board): Readonly<ElementRecord>[] {
  return selectedElements(board).filter((el) => !el.locked);
}

function canEdit(board: Board): boolean {
  return !board.readOnly && unlockedSelection(board).length > 0;
}

/** New sibling order for `mode`; only members of `moving` change position. */
function reorder<T extends { id: string }>(
  siblings: readonly T[],
  moving: ReadonlySet<string>,
  mode: LayerMode,
): T[] {
  const order = [...siblings];
  const isMoving = (item: T | undefined) => item !== undefined && moving.has(item.id);
  if (mode === 'front') return [...order.filter((s) => !isMoving(s)), ...order.filter(isMoving)];
  if (mode === 'back') return [...order.filter(isMoving), ...order.filter((s) => !isMoving(s))];
  if (mode === 'forward') {
    // Top-down, so a block of selected elements moves up together past one sibling.
    for (let i = order.length - 2; i >= 0; i--) {
      if (isMoving(order[i]) && !isMoving(order[i + 1])) {
        [order[i], order[i + 1]] = [order[i + 1]!, order[i]!];
      }
    }
  } else {
    for (let i = 1; i < order.length; i++) {
      if (isMoving(order[i]) && !isMoving(order[i - 1])) {
        [order[i], order[i - 1]] = [order[i - 1]!, order[i]!];
      }
    }
  }
  return order;
}

/**
 * New indexes for the moving elements of `order`. Elements that stay keep their index, and a run of
 * moving elements already in the right place keeps its indexes too.
 */
function assignIndexes(
  order: readonly Readonly<ElementRecord>[],
  moving: ReadonlySet<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < order.length) {
    if (!moving.has(order[i]!.id)) {
      i++;
      continue;
    }
    let j = i;
    while (j < order.length && moving.has(order[j]!.id)) j++;
    const run = order.slice(i, j);
    const lo = i > 0 ? order[i - 1]!.index : null;
    const hi = j < order.length ? order[j]!.index : null;
    const inPlace = run.every((el, k) => {
      const below = k === 0 ? lo : run[k - 1]!.index;
      return below === null || compareIndex(below, el.index) < 0;
    });
    if (!inPlace || (hi !== null && compareIndex(run[run.length - 1]!.index, hi) >= 0)) {
      // Equal neighbour indexes (possible in loaded data) leave no gap: place the run above.
      const upper = lo !== null && hi !== null && compareIndex(lo, hi) >= 0 ? null : hi;
      const indexes = indicesBetween(lo, upper, run.length);
      run.forEach((el, k) => out.set(el.id, indexes[k]!));
    }
    i = j;
  }
  return out;
}

function changeLayer(board: Board, mode: LayerMode): void {
  const selected = unlockedSelection(board);
  const moving = new Set(selected.map((el) => el.id));
  const groups = new Map<string, Readonly<ElementRecord>>();
  for (const el of selected) groups.set(`${el.pageId}\u0000${el.parentId ?? ''}`, el);
  board.history.batch(`layer.${mode}`, () => {
    for (const el of groups.values()) {
      const siblings = board.query({ pageId: el.pageId, parentId: el.parentId });
      const indexes = assignIndexes(reorder(siblings, moving, mode), moving);
      for (const [id, index] of indexes) board.update(id, { index });
    }
  });
}

function setLocked(board: Board, ids: readonly string[], locked: boolean): void {
  board.history.batch(locked ? 'element.lock' : 'element.unlock', () => {
    for (const id of ids) board.update(id, { locked }, { force: true });
  });
}

/** Whether an ancestor of `el` is in `ids` (its copy then comes along with the ancestor's). */
function hasAncestorIn(
  board: Board,
  el: Readonly<ElementRecord>,
  ids: ReadonlySet<string>,
): boolean {
  const seen = new Set<string>();
  let parentId = el.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    if (ids.has(parentId)) return true;
    seen.add(parentId);
    parentId = board.getElement(parentId)?.parentId ?? null;
  }
  return false;
}

/** Copies `el` and its descendants. Returns the copy's ID, or `undefined` when rejected. */
function copyTree(
  board: Board,
  el: Readonly<ElementRecord>,
  parentId: string | null,
  index: string | undefined,
  offset: Point,
): string | undefined {
  const copy = board.create({
    type: el.type,
    pageId: el.pageId,
    parentId,
    index,
    x: el.x + offset.x,
    y: el.y + offset.y,
    rotation: el.rotation,
    w: el.w,
    h: el.h,
    opacity: el.opacity,
    props: el.props,
    meta: el.meta,
  });
  if (!copy) return undefined;
  // Children keep their own order under the new parent, so their indexes can be reused.
  for (const child of board.query({ pageId: el.pageId, parentId: el.id })) {
    copyTree(board, child, copy.id, child.index, offset);
  }
  return copy.id;
}

function duplicate(board: Board, offset: Point): void {
  const selected = selectedElements(board);
  const ids = new Set(selected.map((el) => el.id));
  const roots = selected
    .filter((el) => !hasAncestorIn(board, el, ids))
    .sort((a, b) => compareIndex(a.index, b.index));
  const copies = board.history.batch('element.duplicate', () =>
    roots.map((el) => copyTree(board, el, el.parentId, undefined, offset)),
  );
  board.select(copies.filter((id): id is string => id !== undefined));
}

/** Top-level, unlocked elements of the current page: what `selection.all` selects. */
function selectableElements(board: Board): Readonly<ElementRecord>[] {
  return board
    .query()
    .filter((el) => !el.locked && (el.parentId === null || !board.getElement(el.parentId)));
}

function hasViewport(board: Board): boolean {
  const { width, height } = board.camera.viewport;
  return width > 0 && height > 0;
}

const layerCommand = (id: string, mode: LayerMode) =>
  defineCommand({
    id,
    label: `command.${id}`,
    isEnabled: canEdit,
    run: (board) => changeLayer(board, mode),
  });

const commands: readonly AnyCommandDefinition[] = [
  layerCommand('layer.bring-forward', 'forward'),
  layerCommand('layer.send-backward', 'backward'),
  layerCommand('layer.bring-to-front', 'front'),
  layerCommand('layer.send-to-back', 'back'),
  defineCommand({
    id: 'element.lock',
    label: 'command.element.lock',
    isEnabled: canEdit,
    run: (board) =>
      setLocked(
        board,
        unlockedSelection(board).map((el) => el.id),
        true,
      ),
  }),
  defineCommand({
    id: 'element.unlock',
    label: 'command.element.unlock',
    isEnabled: (board) => !board.readOnly && selectedElements(board).some((el) => el.locked),
    run: (board) =>
      setLocked(
        board,
        selectedElements(board)
          .filter((el) => el.locked)
          .map((el) => el.id),
        false,
      ),
  }),
  defineCommand({
    id: 'element.toggle-lock',
    label: 'command.element.toggle-lock',
    isEnabled: (board) => !board.readOnly && selectedElements(board).length > 0,
    run: (board) => {
      // Any unlocked element in the selection means "lock all"; otherwise unlock all.
      const unlocked = unlockedSelection(board);
      if (unlocked.length > 0)
        setLocked(
          board,
          unlocked.map((el) => el.id),
          true,
        );
      else
        setLocked(
          board,
          selectedElements(board).map((el) => el.id),
          false,
        );
    },
  }),
  defineCommand<DuplicateArgs>({
    id: 'element.duplicate',
    label: 'command.element.duplicate',
    isEnabled: (board) => !board.readOnly && selectedElements(board).length > 0,
    run: (board, args) => duplicate(board, args?.offset ?? DEFAULT_DUPLICATE_OFFSET),
  }),
  defineCommand({
    id: 'element.delete',
    label: 'command.element.delete',
    isEnabled: canEdit,
    run: (board) => {
      board.delete(
        unlockedSelection(board).map((el) => el.id),
        { label: 'element.delete' },
      );
    },
  }),
  defineCommand({
    id: 'selection.all',
    label: 'command.selection.all',
    isEnabled: (board) => selectableElements(board).length > 0,
    run: (board) => board.select(selectableElements(board).map((el) => el.id)),
  }),
  defineCommand({
    id: 'camera.zoom-to-fit',
    label: 'command.camera.zoom-to-fit',
    isEnabled: (board) => hasViewport(board) && board.query().length > 0,
    // Same fit as `board.camera.zoomToFit` (BOARD-402): padding, and at most 100% zoom.
    run: (board) => void board.camera.zoomToFit(),
  }),
  defineCommand({
    id: 'camera.zoom-to-selection',
    label: 'command.camera.zoom-to-selection',
    isEnabled: (board) => hasViewport(board) && board.selectionBounds !== null,
    run: (board) => void board.camera.zoomToSelection(),
  }),
];

/**
 * Built-in commands (BOARD-505) and their shortcuts (BOARD-504):
 *
 * | Command | Shortcut |
 * | --- | --- |
 * | `layer.bring-forward` / `layer.send-backward` | `Mod+]` / `Mod+[` |
 * | `layer.bring-to-front` / `layer.send-to-back` | `Shift+Mod+]` / `Shift+Mod+[` |
 * | `element.toggle-lock` (plus `element.lock`, `element.unlock`) | `Shift+Mod+L` |
 * | `element.duplicate` (args {@link DuplicateArgs}) | `Mod+D` |
 * | `element.delete` | `Delete`, `Backspace` |
 * | `selection.all` | `Mod+A` |
 * | `camera.zoom-to-fit` / `camera.zoom-to-selection` | `Shift+1` / `Shift+2` |
 *
 * Layer commands only change the index of elements that move, among siblings with the same page and
 * parent. Locked elements are not moved, deleted, or selected by `selection.all`; `element.unlock`
 * and `element.toggle-lock` can unlock them when they are selected through the API.
 *
 * @example
 * ```ts
 * const board = createBoard({ plugins: [defaultCommands, defaultElements, defaultTools] });
 * board.run('element.duplicate', { offset: { x: 32, y: 0 } });
 * ```
 *
 * @beta
 */
export const defaultCommands = definePlugin({
  id: 'default-commands',
  commands: commands,
  keybindings: {
    'Mod+]': 'layer.bring-forward',
    'Mod+[': 'layer.send-backward',
    'Shift+Mod+]': 'layer.bring-to-front',
    'Shift+Mod+[': 'layer.send-to-back',
    'Shift+Mod+L': 'element.toggle-lock',
    'Mod+D': 'element.duplicate',
    Delete: 'element.delete',
    Backspace: 'element.delete',
    'Mod+A': 'selection.all',
    'Shift+1': 'camera.zoom-to-fit',
    'Shift+2': 'camera.zoom-to-selection',
  },
});
