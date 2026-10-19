/**
 * Copies made by Alt+drag in the select tool (BOARD-903).
 *
 * @internal
 */

import {
  compareIndex,
  indicesBetween,
  type BindingRecord,
  type Board,
  type BoardRecord,
  type ElementRecord,
} from '@kujam/core';

/** Records to write for a duplicate, and the copies of the given roots in the same order. */
export interface DuplicateRecords {
  readonly records: readonly BoardRecord[];
  readonly copies: readonly ElementRecord[];
}

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

/** Index of the topmost sibling under `parentId` on `pageId`, or `null` when there is none. */
function topIndex(board: Board, pageId: string, parentId: string | null): string | null {
  const siblings = board.query({ pageId, parentId });
  return siblings.length > 0 ? siblings[siblings.length - 1]!.index : null;
}

/**
 * Builds copies of `elements` (with their descendants) at the same position, without writing them.
 * Copies of top-level elements are stacked above their siblings, in the original order. Bindings
 * between copied elements are copied too; connector endpoints bound outside the copy are unbound.
 * Elements the permission hooks do not allow to create are skipped.
 */
export function buildDuplicate(
  board: Board,
  elements: readonly Readonly<ElementRecord>[],
): DuplicateRecords {
  const ids = new Set(elements.map((el) => el.id));
  const roots = elements.filter((el) => !hasAncestorIn(board, el, ids) && board.can('create', el));

  // New indexes per (page, parent) group, above the current top sibling.
  const groups = new Map<string, Readonly<ElementRecord>[]>();
  for (const el of roots) {
    const key = `${el.pageId}\u0000${el.parentId ?? ''}`;
    const group = groups.get(key);
    if (group) group.push(el);
    else groups.set(key, [el]);
  }
  const rootIndex = new Map<string, string>();
  for (const group of groups.values()) {
    group.sort((a, b) => compareIndex(a.index, b.index));
    const first = group[0]!;
    const indexes = indicesBetween(
      topIndex(board, first.pageId, first.parentId),
      null,
      group.length,
    );
    group.forEach((el, i) => rootIndex.set(el.id, indexes[i]!));
  }

  const idMap = new Map<string, string>();
  const copiesById = new Map<string, ElementRecord>();
  const visit = (el: Readonly<ElementRecord>, parentId: string | null, index: string): void => {
    const id = board.createId();
    idMap.set(el.id, id);
    copiesById.set(id, { ...el, id, parentId, index, locked: false });
    // Children keep their own order under the new parent, so their indexes can be reused.
    for (const child of board.query({ pageId: el.pageId, parentId: el.id })) {
      visit(child, id, child.index);
    }
  };
  for (const el of roots) visit(el, el.parentId, rootIndex.get(el.id)!);

  const bindings: BindingRecord[] = [];
  const bindingMap = new Map<string, string>();
  for (const rec of Object.values(board.getDocument().records)) {
    if (rec.kind !== 'binding' || !idMap.has(rec.fromId) || !idMap.has(rec.toId)) continue;
    const id = board.createId();
    bindingMap.set(rec.id, id);
    bindings.push({ ...rec, id, fromId: idMap.get(rec.fromId)!, toId: idMap.get(rec.toId)! });
  }

  for (const [id, copy] of copiesById) {
    const props = copy.props as Record<string, unknown>;
    let next: Record<string, unknown> | null = null;
    for (const key of ['startBindingId', 'endBindingId'] as const) {
      if (!Object.hasOwn(props, key)) continue;
      const old = props[key];
      next ??= { ...props };
      next[key] = typeof old === 'string' ? (bindingMap.get(old) ?? null) : null;
    }
    if (next) copiesById.set(id, { ...copy, props: next });
  }

  return {
    records: [...copiesById.values(), ...bindings],
    copies: roots.map((el) => copiesById.get(idMap.get(el.id)!)!),
  };
}
