/**
 * Elements as drop targets for other elements (BOARD-1208).
 *
 * An element type opts in with `defineElement({ dropTarget: { accepts, onDrop } })`. Tools that
 * move elements (the select tool) ask {@link findDropTarget} what is under the pointer while
 * dragging, to highlight it, and call {@link dropOnTarget} on release. The drop runs in one
 * transaction, so inside a tool interaction it joins the move as a single undo step.
 *
 * @packageDocumentation
 */

import { compareIndex } from '../document/indexing.js';
import { containsPoint, resolveElementGeometry, type Point } from '../geometry/geometry.js';
import type { Board } from '../index.js';
import type { ElementRecord } from '../types.js';
import type { AnyElementDefinition, ElementDropContext, ElementDropTarget } from './elements.js';

/**
 * Result of {@link dropOnTarget}.
 *
 * @beta
 */
export interface DropOnTargetResult {
  /** ID of the element that received the drop. */
  readonly targetId: string;
  /** IDs of the dropped elements the target accepted, in the order `onDrop` ran. */
  readonly acceptedIds: readonly string[];
  /** IDs of accepted elements that `onDrop` removed with `ctx.removeDropped()`. */
  readonly removedIds: readonly string[];
}

interface DropMatch {
  readonly target: Readonly<ElementRecord>;
  readonly dropTarget: ElementDropTarget;
  readonly accepted: readonly Readonly<ElementRecord>[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Layer indexes from the outermost ancestor down to the element, for paint order. */
function paintKey(board: Board, el: Readonly<ElementRecord>): string[] {
  const key = [el.index];
  const seen = new Set([el.id]);
  let parentId = el.parentId;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = board.getElement(parentId);
    if (!parent) break;
    seen.add(parentId);
    key.unshift(parent.index);
    parentId = parent.parentId;
  }
  return key;
}

function comparePaint(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = compareIndex(a[i]!, b[i]!);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/** Whether `id` is one of `roots` or lies inside one of them. */
function isWithin(board: Board, id: string, roots: ReadonlySet<string>): boolean {
  let current: string | null = id;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current)) {
    if (roots.has(current)) return true;
    seen.add(current);
    current = board.getElement(current)?.parentId ?? null;
  }
  return false;
}

function hasDropTargets(board: Board): boolean {
  return board.elements.list().some((def) => def.dropTarget !== undefined);
}

function findMatch(
  board: Board,
  droppedIds: readonly string[],
  point: Point,
  report: boolean,
): DropMatch | null {
  if (board.readOnly || droppedIds.length === 0) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (!hasDropTargets(board)) return null;

  const roots = new Set(droppedIds);
  const dropped = droppedIds
    .map((id) => board.getElement(id))
    .filter((el): el is Readonly<ElementRecord> => el !== undefined && !el.locked);
  if (dropped.length === 0) return null;

  const pageId = board.pages.current;
  let best: { match: DropMatch; key: string[] } | null = null;
  const ids = board.spatial.search({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y });
  for (const id of ids) {
    const target = board.getElement(id);
    if (!target || target.locked || target.pageId !== pageId) continue;
    const def: AnyElementDefinition | undefined = board.elements.get(target.type);
    const dropTarget = def?.dropTarget;
    if (!dropTarget) continue;
    // A dragged element (or anything inside one) never receives its own drop.
    if (isWithin(board, target.id, roots)) continue;
    const geometry = resolveElementGeometry(target, def.geometry && (() => def.geometry!(target)));
    if (!containsPoint(geometry, point, { element: target })) continue;
    if (!board.can('update', target)) continue;

    const accepted = dropped.filter((el) => {
      if (el.pageId !== pageId) return false;
      try {
        return dropTarget.accepts(el, target) === true;
      } catch (error) {
        if (report) {
          board.reportError(
            'plugin-error',
            `dropTarget.accepts elemen "${target.id}" (${target.type}) melempar error: ${messageOf(error)}`,
            error,
          );
        }
        return false;
      }
    });
    if (accepted.length === 0) continue;

    const key = paintKey(board, target);
    const order = best ? comparePaint(key, best.key) : 1;
    if (order > 0 || (order === 0 && target.id > best!.match.target.id)) {
      best = { match: { target, dropTarget, accepted }, key };
    }
  }
  return best?.match ?? null;
}

/**
 * The topmost element under `point` whose type declares a `dropTarget` that accepts at least one
 * of the dragged elements (BOARD-1208), or `undefined` when there is none. Locked targets, targets
 * the permission hooks do not allow to update, and the dragged elements themselves (with their
 * descendants) are skipped. Cheap enough to call on every pointer move: it returns immediately
 * when no registered element type declares a drop target.
 *
 * @param droppedIds - IDs of the elements being dragged (usually the selection).
 * @param point - Pointer position in board coordinates.
 * @beta
 */
export function findDropTarget(
  board: Board,
  droppedIds: readonly string[],
  point: Point,
): Readonly<ElementRecord> | undefined {
  return findMatch(board, droppedIds, point, false)?.target;
}

/**
 * Drops the dragged elements onto the drop target under `point` (BOARD-1208): runs the target's
 * `dropTarget.onDrop` once per accepted element, all in one transaction labelled
 * `'element.drop'`. Call it inside a tool interaction (`ctx.change`) so the move and the drop form
 * a single undo step.
 *
 * Errors thrown by `accepts` or `onDrop` never escape: they are reported as a `plugin-error`
 * event, and a throwing `onDrop` rolls back every change of the drop.
 *
 * @returns What was dropped, or `null` when there is no accepting target under `point` or the
 *   drop failed.
 * @beta
 */
export function dropOnTarget(
  board: Board,
  droppedIds: readonly string[],
  point: Point,
): DropOnTargetResult | null {
  const match = findMatch(board, droppedIds, point, true);
  if (!match) return null;
  const { target, dropTarget, accepted } = match;
  const at = Object.freeze({ x: point.x, y: point.y });
  const acceptedIds: string[] = [];
  const removedIds: string[] = [];

  try {
    board.transact(
      (tx) => {
        for (const original of accepted) {
          // Reads go through the transaction, so they see what earlier `onDrop` calls wrote.
          const current = tx.get(target.id);
          const dropped = tx.get(original.id);
          // An earlier `onDrop` may have removed the target or this element.
          if (current?.kind !== 'element' || dropped?.kind !== 'element') continue;
          let removed = false;
          const ctx: ElementDropContext = Object.freeze(
            Object.assign(Object.create(board.elementContext) as ElementDropContext, {
              updateProps: (patch: Partial<Record<string, unknown>>): boolean =>
                board.update(target.id, { props: patch }) !== undefined,
              removeDropped: (): boolean => {
                if (removed) return true;
                removed = board.delete(dropped.id).includes(dropped.id);
                return removed;
              },
            }),
          );
          dropTarget.onDrop(current, dropped, at, ctx);
          acceptedIds.push(dropped.id);
          if (removed) removedIds.push(dropped.id);
        }
      },
      { label: 'element.drop' },
    );
  } catch (error) {
    board.reportError(
      'plugin-error',
      `dropTarget.onDrop elemen "${target.id}" (${target.type}) melempar error: ${messageOf(error)}`,
      error,
    );
    return null;
  }

  return Object.freeze({
    targetId: target.id,
    acceptedIds: Object.freeze(acceptedIds),
    removedIds: Object.freeze(removedIds),
  });
}
