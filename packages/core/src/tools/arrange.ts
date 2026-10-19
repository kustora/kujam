/**
 * Alignment, distribution, and layout commands for multiple elements (BOARD-905).
 *
 * @packageDocumentation
 */

import { defineCommand, type AnyCommandDefinition } from './commands.js';
import { geometryBounds, resolveElementGeometry } from '../geometry/geometry.js';
import type { BoxBounds } from '../geometry/spatial.js';
import type { Board } from '../index.js';
import type { ElementRecord } from '../types.js';

/**
 * Supported alignment modes for {@link alignElements}.
 *
 * @beta
 */
export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'center-h' | 'center-v';

/**
 * Supported distribution axes for {@link distributeElements}.
 *
 * @beta
 */
export type DistributeAxis = 'horizontal' | 'vertical';

/**
 * Options for {@link arrangeElementsGrid}.
 *
 * @beta
 */
export interface ArrangeGridOptions {
  /** Number of columns. Defaults to `ceil(sqrt(N))`. */
  readonly columns?: number;
  /** Gap between elements in both dimensions, in board units. Defaults to {@link DEFAULT_ARRANGE_GAP}. */
  readonly gap?: number;
  /** Horizontal gap between columns in board units. Overrides `gap`. */
  readonly gapX?: number;
  /** Vertical gap between rows in board units. Overrides `gap`. */
  readonly gapY?: number;
}

/**
 * Options for {@link arrangeElementsRow}.
 *
 * @beta
 */
export interface ArrangeRowOptions {
  /** Gap between adjacent elements, in board units. Defaults to {@link DEFAULT_ARRANGE_GAP}. */
  readonly gap?: number;
}

/**
 * Default gap between elements when arranging in a grid or row, in board units.
 *
 * @beta
 */
export const DEFAULT_ARRANGE_GAP = 24;

/**
 * Returns top-level selected elements that can be modified and moved, filtering out locked
 * elements, unauthorized elements, and any element whose ancestor is also selected.
 */
function getTargetElements(board: Board): Readonly<ElementRecord>[] {
  const selected: Readonly<ElementRecord>[] = [];
  for (const id of board.selection) {
    const el = board.getElement(id);
    if (el && !el.locked && board.can('update', el)) {
      selected.push(el);
    }
  }
  if (selected.length === 0) return [];

  const selectedIds = new Set(selected.map((el) => el.id));
  return selected.filter((el) => {
    let parentId = el.parentId;
    const visited = new Set<string>();
    while (parentId !== null && !visited.has(parentId)) {
      if (selectedIds.has(parentId)) return false;
      visited.add(parentId);
      parentId = board.getElement(parentId)?.parentId ?? null;
    }
    return true;
  });
}

function getElementAABB(board: Board, el: Readonly<ElementRecord>): BoxBounds {
  const b = board.spatial.getBounds(el.id);
  if (b) return b;
  const def = board.elements.get(el.type);
  const geom = resolveElementGeometry(el, def?.geometry && (() => def.geometry!(el as never)));
  return geometryBounds(geom, el);
}

function moveElementWithDescendants(
  board: Board,
  el: Readonly<ElementRecord>,
  dx: number,
  dy: number,
): void {
  if (dx === 0 && dy === 0) return;
  board.update(el.id, { x: el.x + dx, y: el.y + dy });

  function moveChildren(parentId: string): void {
    const children = board.query({ pageId: el.pageId, parentId });
    for (const child of children) {
      board.update(child.id, { x: child.x + dx, y: child.y + dy });
      moveChildren(child.id);
    }
  }

  moveChildren(el.id);
}

/**
 * Aligns selected elements along the specified edge or center line (BOARD-905).
 *
 * Requires at least 2 top-level unlocked selected elements. Operates within a single undo step.
 *
 * @returns `true` when alignment succeeded, `false` when disabled or preconditions are not met.
 * @beta
 */
export function alignElements(board: Board, mode: AlignMode): boolean {
  if (board.readOnly) return false;
  const targets = getTargetElements(board);
  if (targets.length < 2) return false;

  const boundsMap = new Map<string, BoxBounds>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of targets) {
    const b = getElementAABB(board, el);
    boundsMap.set(el.id, b);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const commandId = `align.${mode}`;

  board.history.batch(commandId, () => {
    board.transact(
      () => {
        for (const el of targets) {
          const b = boundsMap.get(el.id)!;
          let dx = 0;
          let dy = 0;

          switch (mode) {
            case 'left':
              dx = minX - b.minX;
              break;
            case 'right':
              dx = maxX - b.maxX;
              break;
            case 'center-h':
              dx = centerX - (b.minX + b.maxX) / 2;
              break;
            case 'top':
              dy = minY - b.minY;
              break;
            case 'bottom':
              dy = maxY - b.maxY;
              break;
            case 'center-v':
              dy = centerY - (b.minY + b.maxY) / 2;
              break;
          }

          moveElementWithDescendants(board, el, dx, dy);
        }
      },
      { label: commandId },
    );
  });

  return true;
}

/**
 * Distributes selected elements evenly along the specified axis (BOARD-905).
 *
 * Preserves the outer positions of the outermost elements and distributes the inner elements
 * with equal spacing between their bounding boxes. Requires at least 3 elements.
 *
 * @returns `true` when distribution succeeded, `false` otherwise.
 * @beta
 */
export function distributeElements(board: Board, axis: DistributeAxis): boolean {
  if (board.readOnly) return false;
  const targets = getTargetElements(board);
  if (targets.length < 3) return false;

  const boundsMap = new Map<string, BoxBounds>();
  for (const el of targets) {
    boundsMap.set(el.id, getElementAABB(board, el));
  }

  const sorted = [...targets].sort((a, b) => {
    const ba = boundsMap.get(a.id)!;
    const bb = boundsMap.get(b.id)!;
    if (axis === 'horizontal') {
      const ca = (ba.minX + ba.maxX) / 2;
      const cb = (bb.minX + bb.maxX) / 2;
      return ca !== cb ? ca - cb : a.id.localeCompare(b.id);
    }
    const ca = (ba.minY + ba.maxY) / 2;
    const cb = (bb.minY + bb.maxY) / 2;
    return ca !== cb ? ca - cb : a.id.localeCompare(b.id);
  });

  const firstB = boundsMap.get(sorted[0]!.id)!;
  const lastB = boundsMap.get(sorted[sorted.length - 1]!.id)!;

  let totalSpan: number;
  let totalSize = 0;

  if (axis === 'horizontal') {
    totalSpan = lastB.maxX - firstB.minX;
    for (const el of sorted) {
      const b = boundsMap.get(el.id)!;
      totalSize += b.maxX - b.minX;
    }
  } else {
    totalSpan = lastB.maxY - firstB.minY;
    for (const el of sorted) {
      const b = boundsMap.get(el.id)!;
      totalSize += b.maxY - b.minY;
    }
  }

  const gap = (totalSpan - totalSize) / (sorted.length - 1);
  const commandId = `distribute.${axis}`;

  board.history.batch(commandId, () => {
    board.transact(
      () => {
        let cursor = axis === 'horizontal' ? firstB.minX : firstB.minY;
        for (let i = 0; i < sorted.length; i++) {
          const el = sorted[i]!;
          const b = boundsMap.get(el.id)!;
          const size = axis === 'horizontal' ? b.maxX - b.minX : b.maxY - b.minY;

          if (i > 0 && i < sorted.length - 1) {
            if (axis === 'horizontal') {
              const dx = cursor - b.minX;
              moveElementWithDescendants(board, el, dx, 0);
            } else {
              const dy = cursor - b.minY;
              moveElementWithDescendants(board, el, 0, dy);
            }
          }
          cursor += size + gap;
        }
      },
      { label: commandId },
    );
  });

  return true;
}

/**
 * Arranges selected elements in a structured 2D grid (BOARD-905).
 *
 * @returns `true` when arrangement succeeded, `false` otherwise.
 * @beta
 */
export function arrangeElementsGrid(board: Board, options?: ArrangeGridOptions): boolean {
  if (board.readOnly) return false;
  const targets = getTargetElements(board);
  if (targets.length < 2) return false;

  const boundsMap = new Map<string, BoxBounds>();
  let minX = Infinity;
  let minY = Infinity;
  for (const el of targets) {
    const b = getElementAABB(board, el);
    boundsMap.set(el.id, b);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
  }

  const columns = Math.max(1, Math.floor(options?.columns ?? Math.ceil(Math.sqrt(targets.length))));
  const gapX = options?.gapX ?? options?.gap ?? DEFAULT_ARRANGE_GAP;
  const gapY = options?.gapY ?? options?.gap ?? DEFAULT_ARRANGE_GAP;
  const rows = Math.ceil(targets.length / columns);

  const colWidths = new Array<number>(columns).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);

  for (let i = 0; i < targets.length; i++) {
    const el = targets[i]!;
    const b = boundsMap.get(el.id)!;
    const c = i % columns;
    const r = Math.floor(i / columns);
    colWidths[c] = Math.max(colWidths[c]!, b.maxX - b.minX);
    rowHeights[r] = Math.max(rowHeights[r]!, b.maxY - b.minY);
  }

  const colOffsets = new Array<number>(columns).fill(0);
  for (let c = 1; c < columns; c++) {
    colOffsets[c] = colOffsets[c - 1]! + colWidths[c - 1]! + gapX;
  }

  const rowOffsets = new Array<number>(rows).fill(0);
  for (let r = 1; r < rows; r++) {
    rowOffsets[r] = rowOffsets[r - 1]! + rowHeights[r - 1]! + gapY;
  }

  const commandId = 'arrange.grid';
  board.history.batch(commandId, () => {
    board.transact(
      () => {
        for (let i = 0; i < targets.length; i++) {
          const el = targets[i]!;
          const b = boundsMap.get(el.id)!;
          const c = i % columns;
          const r = Math.floor(i / columns);
          const targetX = minX + colOffsets[c]!;
          const targetY = minY + rowOffsets[r]!;
          const dx = targetX - b.minX;
          const dy = targetY - b.minY;
          moveElementWithDescendants(board, el, dx, dy);
        }
      },
      { label: commandId },
    );
  });

  return true;
}

/**
 * Arranges selected elements in a single horizontal row (BOARD-905).
 *
 * @returns `true` when arrangement succeeded, `false` otherwise.
 * @beta
 */
export function arrangeElementsRow(board: Board, options?: ArrangeRowOptions): boolean {
  if (board.readOnly) return false;
  const targets = getTargetElements(board);
  if (targets.length < 2) return false;

  const boundsMap = new Map<string, BoxBounds>();
  let minX = Infinity;
  let minY = Infinity;
  for (const el of targets) {
    const b = getElementAABB(board, el);
    boundsMap.set(el.id, b);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
  }

  const gap = options?.gap ?? DEFAULT_ARRANGE_GAP;
  const commandId = 'arrange.row';

  board.history.batch(commandId, () => {
    board.transact(
      () => {
        let cursorX = minX;
        for (const el of targets) {
          const b = boundsMap.get(el.id)!;
          const w = b.maxX - b.minX;
          const dx = cursorX - b.minX;
          const dy = minY - b.minY;
          moveElementWithDescendants(board, el, dx, dy);
          cursorX += w + gap;
        }
      },
      { label: commandId },
    );
  });

  return true;
}

/**
 * Built-in arrange and distribute command definitions (BOARD-905).
 *
 * @beta
 */
export const ARRANGE_COMMANDS: readonly AnyCommandDefinition[] = [
  ...(['left', 'right', 'top', 'bottom', 'center-h', 'center-v'] as const).map((mode) =>
    defineCommand({
      id: `align.${mode}`,
      label: `command.align.${mode}`,
      isEnabled: (board) => !board.readOnly && getTargetElements(board).length >= 2,
      run: (board) => alignElements(board, mode),
    }),
  ),
  defineCommand({
    id: 'distribute.horizontal',
    label: 'command.distribute.horizontal',
    isEnabled: (board) => !board.readOnly && getTargetElements(board).length >= 3,
    run: (board) => distributeElements(board, 'horizontal'),
  }),
  defineCommand({
    id: 'distribute.vertical',
    label: 'command.distribute.vertical',
    isEnabled: (board) => !board.readOnly && getTargetElements(board).length >= 3,
    run: (board) => distributeElements(board, 'vertical'),
  }),
  defineCommand<ArrangeGridOptions>({
    id: 'arrange.grid',
    label: 'command.arrange.grid',
    isEnabled: (board) => !board.readOnly && getTargetElements(board).length >= 2,
    run: (board, args) => arrangeElementsGrid(board, args),
  }),
  defineCommand<ArrangeRowOptions>({
    id: 'arrange.row',
    label: 'command.arrange.row',
    isEnabled: (board) => !board.readOnly && getTargetElements(board).length >= 2,
    run: (board, args) => arrangeElementsRow(board, args),
  }),
];
