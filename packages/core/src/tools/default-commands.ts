/**
 * Built-in commands: undo/redo, layer order, lock, duplicate, delete, select all, and zoom
 * (BOARD-505), plus keyboard navigation: Tab through elements in reading order, Esc to leave the
 * selection, and arrow keys to nudge (BOARD-1902).
 *
 * Shipped as the {@link defaultCommands} plugin, built only on the public `Board` API like any
 * custom plugin. Each command that changes the document is one undo step, and every command
 * reports itself disabled (`isEnabled`) when it has nothing to act on or the board is read-only.
 */

import { defineCommand, type AnyCommandDefinition } from './commands.js';
import { nextZoomStep } from '../camera/camera.js';
import type { Point } from '../geometry/geometry.js';
import type { Board } from '../index.js';
import { compareIndex, indicesBetween } from '../document/indexing.js';
import { definePlugin } from '../plugins/plugins.js';
import type { ElementRecord } from '../types.js';
import { nextInReadingOrder, revealBounds, type ReadingDirection } from '../a11y/reading-order.js';
import { ARRANGE_COMMANDS } from './arrange.js';
import { GROUP_COMMANDS, GROUP_KEYBINDINGS } from '../elements/containers.js';

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

/**
 * Distance of the arrow-key nudge commands, in board units (BOARD-1902).
 *
 * @beta
 */
export const NUDGE_DISTANCE = 1;

/**
 * Distance of the Shift+arrow nudge commands, in board units (BOARD-1902).
 *
 * @beta
 */
export const NUDGE_DISTANCE_LARGE = 10;

/**
 * Arguments of the `element.nudge-*` commands.
 *
 * @beta
 */
export interface NudgeArgs {
  /**
   * Distance in board units. Defaults to {@link NUDGE_DISTANCE}, or {@link NUDGE_DISTANCE_LARGE}
   * for the `-large` commands.
   */
  readonly distance?: number;
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
  idMap: Map<string, string>,
): string | undefined {
  const hasStartBId = Object.hasOwn(el.props, 'startBindingId');
  const hasEndBId = Object.hasOwn(el.props, 'endBindingId');
  const props =
    hasStartBId || hasEndBId
      ? {
          ...el.props,
          ...(hasStartBId ? { startBindingId: null } : {}),
          ...(hasEndBId ? { endBindingId: null } : {}),
        }
      : el.props;
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
    props,
    meta: el.meta,
  });
  if (!copy) return undefined;
  idMap.set(el.id, copy.id);
  // Children keep their own order under the new parent, so their indexes can be reused.
  for (const child of board.query({ pageId: el.pageId, parentId: el.id })) {
    copyTree(board, child, copy.id, child.index, offset, idMap);
  }
  return copy.id;
}

function duplicate(board: Board, offset: Point): void {
  const selected = selectedElements(board);
  const ids = new Set(selected.map((el) => el.id));
  const roots = selected
    .filter((el) => !hasAncestorIn(board, el, ids))
    .sort((a, b) => compareIndex(a.index, b.index));
  const doc = board.getDocument();
  const idMap = new Map<string, string>();
  const copies = board.history.batch('element.duplicate', () => {
    const out = roots.map((el) => copyTree(board, el, el.parentId, undefined, offset, idMap));
    const bindingIdMap = new Map<string, string>();
    board.transact((tx) => {
      for (const rec of Object.values(doc.records)) {
        if (rec.kind === 'binding' && idMap.has(rec.fromId) && idMap.has(rec.toId)) {
          const newBId = board.createId();
          bindingIdMap.set(rec.id, newBId);
          tx.put({
            id: newBId,
            kind: 'binding',
            fromId: idMap.get(rec.fromId)!,
            toId: idMap.get(rec.toId)!,
            anchor: rec.anchor,
          });
        }
      }
      if (bindingIdMap.size > 0) {
        for (const [origId, copyId] of idMap) {
          const origEl = doc.records[origId];
          const copyEl = tx.get(copyId);
          if (!origEl || origEl.kind !== 'element' || !copyEl || copyEl.kind !== 'element')
            continue;
          const origStart = origEl.props.startBindingId;
          const origEnd = origEl.props.endBindingId;
          const nextStart =
            typeof origStart === 'string' ? (bindingIdMap.get(origStart) ?? null) : null;
          const nextEnd = typeof origEnd === 'string' ? (bindingIdMap.get(origEnd) ?? null) : null;
          if (nextStart !== null || nextEnd !== null) {
            tx.put({
              ...copyEl,
              props: {
                ...copyEl.props,
                ...(Object.hasOwn(origEl.props, 'startBindingId')
                  ? { startBindingId: nextStart }
                  : {}),
                ...(Object.hasOwn(origEl.props, 'endBindingId') ? { endBindingId: nextEnd } : {}),
              },
            });
          }
        }
      }
    });
    return out;
  });
  board.select(copies.filter((id): id is string => id !== undefined));
}

/** Top-level, unlocked elements of the current page: what `selection.all` selects. */
function selectableElements(board: Board): Readonly<ElementRecord>[] {
  return board
    .query()
    .filter((el) => !el.locked && (el.parentId === null || !board.getElement(el.parentId)));
}

/** Element that keyboard navigation continues from: the most recently selected one. */
function focusAnchor(board: Board): string | null {
  return board.selection[board.selection.length - 1] ?? null;
}

function selectInReadingOrder(board: Board, direction: ReadingDirection): void {
  const id = nextInReadingOrder(board, focusAnchor(board), direction);
  if (id === undefined) return;
  board.select(id);
  const bounds = board.spatial.getBounds(id);
  if (bounds) revealBounds(board, bounds);
}

type NudgeDirection = 'left' | 'right' | 'up' | 'down';

const NUDGE_VECTORS: Readonly<Record<NudgeDirection, Readonly<Point>>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
};

function nudgeDistance(args: NudgeArgs | undefined, fallback: number): number {
  const distance = args?.distance;
  return typeof distance === 'number' && Number.isFinite(distance) ? distance : fallback;
}

function nudge(board: Board, direction: NudgeDirection, distance: number): void {
  const selected = unlockedSelection(board);
  const { x, y } = NUDGE_VECTORS[direction];
  // One undo step per held key or quick series of presses (BOARD-302 merge window).
  const mergeKey = `element.nudge:${selected.map((el) => el.id).join(',')}`;
  board.transact(
    () => {
      for (const el of selected) {
        board.update(el.id, { x: el.x + x * distance, y: el.y + y * distance });
      }
    },
    { label: 'element.nudge', mergeKey },
  );
  const bounds = board.selectionBounds;
  if (bounds) revealBounds(board, bounds);
}

const nudgeCommand = (direction: NudgeDirection, large: boolean) =>
  defineCommand<NudgeArgs>({
    id: `element.nudge-${direction}${large ? '-large' : ''}`,
    label: `command.element.nudge-${direction}${large ? '-large' : ''}`,
    isEnabled: canEdit,
    repeatable: true,
    run: (board, args) =>
      nudge(board, direction, nudgeDistance(args, large ? NUDGE_DISTANCE_LARGE : NUDGE_DISTANCE)),
  });

function hasViewport(board: Board): boolean {
  const { width, height } = board.camera.viewport;
  return width > 0 && height > 0;
}

/** Zooms to the next `ZOOM_STEPS` level around the viewport center (BOARD-901). */
function zoomStep(board: Board, direction: 1 | -1): void {
  board.camera.zoomTo(nextZoomStep(board.camera.get().zoom, direction, board.camera.zoomRange));
}

const layerCommand = (id: string, mode: LayerMode) =>
  defineCommand({
    id,
    label: `command.${id}`,
    isEnabled: canEdit,
    run: (board) => changeLayer(board, mode),
  });

const commands: readonly AnyCommandDefinition[] = [
  // `board.undo`/`board.redo` do nothing on read-only boards (their history is always empty).
  defineCommand({
    id: 'history.undo',
    label: 'command.history.undo',
    isEnabled: (board) => !board.readOnly && board.history.canUndo,
    run: (board) => void board.undo(),
  }),
  defineCommand({
    id: 'history.redo',
    label: 'command.history.redo',
    isEnabled: (board) => !board.readOnly && board.history.canRedo,
    run: (board) => void board.redo(),
  }),
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
    id: 'selection.next',
    label: 'command.selection.next',
    // Disabled at the last element, so Tab is left to the browser and focus leaves the board.
    isEnabled: (board) => nextInReadingOrder(board, focusAnchor(board), 'next') !== undefined,
    repeatable: true,
    run: (board) => selectInReadingOrder(board, 'next'),
  }),
  defineCommand({
    id: 'selection.previous',
    label: 'command.selection.previous',
    isEnabled: (board) => nextInReadingOrder(board, focusAnchor(board), 'previous') !== undefined,
    repeatable: true,
    run: (board) => selectInReadingOrder(board, 'previous'),
  }),
  defineCommand({
    id: 'selection.clear',
    label: 'command.selection.clear',
    isEnabled: (board) => board.selection.length > 0,
    run: (board) => board.clearSelection(),
  }),
  ...(['left', 'right', 'up', 'down'] as const).flatMap((direction) => [
    nudgeCommand(direction, false),
    nudgeCommand(direction, true),
  ]),
  defineCommand({
    id: 'camera.zoom-in',
    label: 'command.camera.zoom-in',
    isEnabled: (board) => board.camera.get().zoom < board.camera.zoomRange.max,
    repeatable: true,
    run: (board) => zoomStep(board, 1),
  }),
  defineCommand({
    id: 'camera.zoom-out',
    label: 'command.camera.zoom-out',
    isEnabled: (board) => board.camera.get().zoom > board.camera.zoomRange.min,
    repeatable: true,
    run: (board) => zoomStep(board, -1),
  }),
  defineCommand({
    id: 'camera.zoom-reset',
    label: 'command.camera.zoom-reset',
    isEnabled: (board) => board.camera.get().zoom !== 1,
    run: (board) => board.camera.zoomTo(1),
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
  ...ARRANGE_COMMANDS,
  ...GROUP_COMMANDS,
];

/**
 * Built-in commands (BOARD-505) and their shortcuts (BOARD-504):
 *
 * | Command | Shortcut |
 * | --- | --- |
 * | `history.undo` / `history.redo` | `Mod+Z` / `Shift+Mod+Z`, `Mod+Y` |
 * | `element.group` / `element.ungroup` | `Mod+G` / `Shift+Mod+G` |
 * | `layer.bring-forward` / `layer.send-backward` | `Mod+]` / `Mod+[` |
 * | `layer.bring-to-front` / `layer.send-to-back` | `Shift+Mod+]` / `Shift+Mod+[` |
 * | `element.toggle-lock` (plus `element.lock`, `element.unlock`) | `Shift+Mod+L` |
 * | `element.duplicate` (args {@link DuplicateArgs}) | `Mod+D` |
 * | `element.delete` | `Delete`, `Backspace` |
 * | `selection.all` | `Mod+A` |
 * | `camera.zoom-to-fit` / `camera.zoom-to-selection` | `Shift+1` / `Shift+2` |
 * | `camera.zoom-in` / `camera.zoom-out` (next `ZOOM_STEPS` level) | `Mod+=`, `Mod++` / `Mod+-` |
 * | `camera.zoom-reset` (100%) | `Mod+0` |
 * | `selection.next` / `selection.previous` (reading order, camera follows) | `Tab` / `Shift+Tab` |
 * | `selection.clear` | `Escape` |
 * | `element.nudge-left` … `element.nudge-down` (args {@link NudgeArgs}, 1 unit) | Arrow keys |
 * | `element.nudge-left-large` … `element.nudge-down-large` (10 units) | `Shift` + arrow keys |
 *
 * Shortcuts are ignored while typing in a text field (`inTextInput`), so the browser's own text undo
 * applies there. Layer commands only change the index of elements that move, among siblings with
 * the same page and parent. Locked elements are not moved, deleted, or selected by `selection.all`; `element.unlock`
 * and `element.toggle-lock` can unlock them when they are selected through the API.
 *
 * Keyboard navigation (BOARD-1902): `selection.next` selects the first element when nothing is
 * selected and is disabled at the last one, and `selection.previous` is disabled at the first one,
 * so Tab and Shift+Tab are then left to the browser and focus can leave the board. Esc runs only
 * after the active tool had nothing to cancel. Nudges and Tab repeat while the key is held, and
 * a run of nudges is one undo step.
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
    // `Shift+Mod+Z` first: `forTarget` lists it before `Mod+Y`, so UI tooltips show it.
    'Mod+Z': 'history.undo',
    'Shift+Mod+Z': 'history.redo',
    'Mod+Y': 'history.redo',
    ...GROUP_KEYBINDINGS,
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
    'Mod+=': 'camera.zoom-in',
    'Mod++': 'camera.zoom-in',
    'Mod+-': 'camera.zoom-out',
    'Mod+0': 'camera.zoom-reset',
    Tab: 'selection.next',
    'Shift+Tab': 'selection.previous',
    Escape: 'selection.clear',
    ArrowLeft: 'element.nudge-left',
    ArrowRight: 'element.nudge-right',
    ArrowUp: 'element.nudge-up',
    ArrowDown: 'element.nudge-down',
    'Shift+ArrowLeft': 'element.nudge-left-large',
    'Shift+ArrowRight': 'element.nudge-right-large',
    'Shift+ArrowUp': 'element.nudge-up-large',
    'Shift+ArrowDown': 'element.nudge-down-large',
  },
});
