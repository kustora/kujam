/**
 * Container element infrastructure: Group, Frame, and hierarchy reconciliation (BOARD-1104, BOARD-909, BOARD-1105).
 *
 * @packageDocumentation
 */

import { compareIndex } from '../document/indexing.js';
import type { Transaction } from '../document/store.js';
import { geometryBounds, resolveElementGeometry, type Point } from '../geometry/geometry.js';
import type { BoxBounds } from '../geometry/spatial.js';
import type { Board } from '../index.js';
import { defineCommand, type AnyCommandDefinition } from '../tools/commands.js';
import type { BoardRecord, ElementRecord } from '../types.js';

/**
 * Frame presentation and query interface (BOARD-1105).
 *
 * @public
 */
export interface BoardFrames {
  /**
   * Returns all frames on the specified page (defaults to current page),
   * sorted in deterministic reading/slide order (top-to-bottom, left-to-right).
   */
  list(pageId?: string): readonly Readonly<ElementRecord>[];

  /**
   * Returns direct child elements of the frame.
   */
  getChildren(frameId: string): readonly Readonly<ElementRecord>[];
}

/**
 * Creates the frames runtime for a board instance.
 *
 * @internal
 */
export function createFramesRuntime(getBoard: () => Board): BoardFrames {
  return {
    list(pageId?: string): readonly Readonly<ElementRecord>[] {
      const board = getBoard();
      const pid = pageId ?? board.pages.current;
      const frames = board
        .query({ pageId: pid, allPages: pageId !== undefined })
        .filter((el) => el.type === 'frame');

      return [...frames].sort((a, b) => {
        // Top-to-bottom with 8-unit vertical threshold for same line, then left-to-right
        if (Math.abs(a.y - b.y) > 8) {
          return a.y - b.y;
        }
        if (Math.abs(a.x - b.x) > 8) {
          return a.x - b.x;
        }
        const idx = compareIndex(a.index, b.index);
        return idx !== 0 ? idx : a.id.localeCompare(b.id);
      });
    },

    getChildren(frameId: string): readonly Readonly<ElementRecord>[] {
      const board = getBoard();
      return board.query({ parentId: frameId, allPages: true });
    },
  };
}

function computeFallbackAABB(el: ElementRecord): BoxBounds {
  const geom = resolveElementGeometry(el);
  return geometryBounds(geom, el);
}

/**
 * Reconciles container relationships in a transaction:
 * - 1-level frame nesting limit (BOARD-1105)
 * - Auto-deletion of empty groups (BOARD-1104)
 * - Auto-computation of group bounds from children (BOARD-1104)
 *
 * @internal
 */
export function reconcileContainersInTransaction(
  tx: Transaction,
  pending: ReadonlyMap<string, BoardRecord | undefined>,
  records: ReadonlyMap<string, BoardRecord>,
  getElementAABB?: (el: ElementRecord) => BoxBounds,
): void {
  const getBounds = getElementAABB ?? computeFallbackAABB;

  function getRecord(id: string): BoardRecord | undefined {
    if (pending.has(id)) return pending.get(id);
    return records.get(id);
  }

  // 1. Frame nesting rule: child frame can only be directly under root frame (1 level max).
  for (const [, rec] of pending) {
    if (rec && rec.kind === 'element' && rec.type === 'frame' && rec.parentId !== null) {
      const parent = getRecord(rec.parentId);
      if (!parent || parent.kind !== 'element') {
        tx.put({ ...rec, parentId: null });
      } else if (parent.type === 'frame') {
        // If parent frame itself has a parent, climb to root or reset
        if (parent.parentId !== null) {
          const grandParent = getRecord(parent.parentId);
          if (grandParent && grandParent.kind === 'element' && grandParent.type === 'frame') {
            tx.put({ ...rec, parentId: grandParent.id });
          } else {
            tx.put({ ...rec, parentId: null });
          }
        }
      }
    }
  }

  // 2. Identify all groups that might need reconciliation
  const allGroupIds = new Set<string>();
  for (const [id, rec] of pending) {
    if (rec && rec.kind === 'element') {
      if (rec.type === 'group') allGroupIds.add(id);
      if (rec.parentId) allGroupIds.add(rec.parentId);
      const before = records.get(id);
      if (before && before.kind === 'element' && before.parentId) {
        allGroupIds.add(before.parentId);
      }
    } else if (rec === undefined) {
      const before = records.get(id);
      if (before && before.kind === 'element' && before.parentId) {
        allGroupIds.add(before.parentId);
      }
    }
  }

  if (allGroupIds.size === 0) return;

  // Gather surviving children for groups
  const groupChildrenMap = new Map<string, ElementRecord[]>();
  const activeGroups = new Map<string, ElementRecord>();

  // Collect all elements from pending and records
  const allIds = new Set<string>([...records.keys(), ...pending.keys()]);
  for (const id of allIds) {
    const rec = getRecord(id);
    if (!rec || rec.kind !== 'element') continue;
    if (rec.type === 'group') {
      activeGroups.set(id, rec);
    }
    if (rec.parentId && allGroupIds.has(rec.parentId)) {
      let list = groupChildrenMap.get(rec.parentId);
      if (!list) {
        list = [];
        groupChildrenMap.set(rec.parentId, list);
      }
      list.push(rec);
    }
  }

  // Sort groups bottom-up (inner groups first)
  const sortedGroupIds = [...allGroupIds].filter((id) => activeGroups.has(id));
  sortedGroupIds.sort((a, b) => {
    // If a is descendant of b, a comes before b
    let p = activeGroups.get(a)?.parentId;
    while (p) {
      if (p === b) return -1;
      const parentRec = getRecord(p);
      p = parentRec && parentRec.kind === 'element' ? parentRec.parentId : null;
    }
    return 0;
  });

  for (const groupId of sortedGroupIds) {
    const group = getRecord(groupId);
    if (!group || group.kind !== 'element' || group.type !== 'group') continue;

    const children = groupChildrenMap.get(groupId) ?? [];
    const validChildren = children.filter((c) => {
      const current = getRecord(c.id);
      return current && current.kind === 'element' && current.parentId === groupId;
    });

    if (validChildren.length === 0) {
      // Empty group: auto-delete if it had children before (BOARD-1104)
      let hadChildrenBefore = false;
      for (const r of records.values()) {
        if (r && r.kind === 'element' && r.parentId === groupId) {
          hadChildrenBefore = true;
          break;
        }
      }
      if (hadChildrenBefore) {
        tx.remove(groupId);
      }
    } else {
      // Auto-compute bounds from children
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const child of validChildren) {
        const b = getBounds(child);
        if (b.minX < minX) minX = b.minX;
        if (b.minY < minY) minY = b.minY;
        if (b.maxX > maxX) maxX = b.maxX;
        if (b.maxY > maxY) maxY = b.maxY;
      }

      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);

      if (
        group.x !== minX ||
        group.y !== minY ||
        group.w !== w ||
        group.h !== h ||
        group.rotation !== 0
      ) {
        tx.put({
          ...group,
          x: minX,
          y: minY,
          w,
          h,
          rotation: 0,
        });
      }
    }
  }
}

/**
 * Returns selected elements eligible for grouping.
 */
function getGroupableSelection(board: Board): Readonly<ElementRecord>[] {
  const selected: Readonly<ElementRecord>[] = [];
  for (const id of board.selection) {
    const el = board.getElement(id);
    if (el && !el.locked && board.can('update', el)) {
      selected.push(el);
    }
  }
  if (selected.length < 2) return [];

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

/**
 * Groups currently selected elements into a new group container (BOARD-1104, BOARD-909).
 *
 * @returns The created group element record, or `undefined` when grouping cannot be performed.
 * @beta
 */
export function groupSelection(board: Board): Readonly<ElementRecord> | undefined {
  if (board.readOnly) return undefined;
  const elements = getGroupableSelection(board);
  if (elements.length < 2) return undefined;

  const firstParentId = elements[0]!.parentId;
  const allSameParent = elements.every((el) => el.parentId === firstParentId);
  const commonParentId = allSameParent ? firstParentId : null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    const b = board.spatial.getBounds(el.id) ?? {
      minX: el.x,
      minY: el.y,
      maxX: el.x + el.w,
      maxY: el.y + el.h,
    };
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  // Pick topmost index of the grouped elements
  const sortedByIndex = [...elements].sort((a, b) => compareIndex(a.index, b.index));
  const topIndex = sortedByIndex[sortedByIndex.length - 1]!.index;

  let createdGroup: Readonly<ElementRecord> | undefined;

  board.history.batch('element.group', () => {
    const group = board.create({
      type: 'group',
      pageId: board.pages.current,
      parentId: commonParentId,
      index: topIndex,
      x: minX,
      y: minY,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY),
      props: {},
    });
    if (!group) return;
    createdGroup = group;

    for (const el of elements) {
      board.update(el.id, { parentId: group.id });
    }
  });

  if (createdGroup) {
    board.select([createdGroup.id]);
  }

  return createdGroup;
}

/**
 * Ungroups any selected group elements, releasing their children to the group's parent (BOARD-909).
 *
 * @returns Array of released child element IDs.
 * @beta
 */
export function ungroupSelection(board: Board): readonly string[] {
  if (board.readOnly) return [];

  const groups = board.selection
    .map((id) => board.getElement(id))
    .filter(
      (el): el is Readonly<ElementRecord> =>
        el !== undefined && el.type === 'group' && !el.locked && board.can('update', el),
    );

  if (groups.length === 0) return [];

  const releasedIds: string[] = [];

  board.history.batch('element.ungroup', () => {
    for (const g of groups) {
      const children = board.query({ pageId: g.pageId, parentId: g.id });
      for (const child of children) {
        board.update(child.id, { parentId: g.parentId });
        releasedIds.push(child.id);
      }
      board.delete(g.id);
    }
  });

  if (releasedIds.length > 0) {
    board.select(releasedIds);
  }

  return releasedIds;
}

/**
 * Built-in group commands (BOARD-909).
 *
 * @beta
 */
export const GROUP_COMMANDS: readonly AnyCommandDefinition[] = [
  defineCommand({
    id: 'element.group',
    label: 'command.element.group',
    isEnabled: (board) => !board.readOnly && getGroupableSelection(board).length >= 2,
    run: (board) => groupSelection(board) !== undefined,
  }),
  defineCommand({
    id: 'element.ungroup',
    label: 'command.element.ungroup',
    isEnabled: (board) =>
      !board.readOnly &&
      board.selection.some((id) => {
        const el = board.getElement(id);
        return el !== undefined && el.type === 'group' && !el.locked;
      }),
    run: (board) => ungroupSelection(board).length > 0,
  }),
];

/**
 * Built-in group keybindings (BOARD-909).
 *
 * @beta
 */
export const GROUP_KEYBINDINGS: Readonly<Record<string, string>> = Object.freeze({
  'Mod+G': 'element.group',
  'Shift+Mod+G': 'element.ungroup',
});

/**
 * Resolves element selection for click events taking groups and entered group into account (BOARD-909).
 *
 * @beta
 */
export function resolveTopmostGroupClick(
  board: Board,
  hit: Readonly<ElementRecord>,
  enteredGroupId: string | null,
): Readonly<ElementRecord> {
  const chain: Readonly<ElementRecord>[] = [hit];
  let p = hit.parentId;
  const visited = new Set<string>();

  while (p !== null && !visited.has(p)) {
    visited.add(p);
    const parentEl = board.getElement(p);
    if (!parentEl) break;
    chain.push(parentEl);
    p = parentEl.parentId;
  }

  if (enteredGroupId !== null) {
    const enteredIdx = chain.findIndex((el) => el.id === enteredGroupId);
    if (enteredIdx > 0) {
      // Return direct child of entered group in the chain
      return chain[enteredIdx - 1]!;
    }
  }

  // Find topmost group ancestor
  let topmostGroup: Readonly<ElementRecord> | undefined;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i]!.type === 'group') {
      topmostGroup = chain[i];
      break;
    }
  }

  return topmostGroup ?? hit;
}

/**
 * Enters a group container on double-click, selecting its topmost child (BOARD-909).
 *
 * @beta
 */
export function enterGroupOnDoubleClick(
  board: Board,
  groupEl: Readonly<ElementRecord>,
  point: Point,
): { enteredGroupId: string; childId: string | null } | null {
  if (groupEl.type !== 'group') return null;
  const children = board.query({ pageId: groupEl.pageId, parentId: groupEl.id });
  if (children.length === 0) return null;

  // Hit-test children from top to bottom
  let hitChild: Readonly<ElementRecord> | undefined;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i]!;
    const b = board.spatial.getBounds(child.id) ?? {
      minX: child.x,
      minY: child.y,
      maxX: child.x + child.w,
      maxY: child.y + child.h,
    };
    if (point.x >= b.minX && point.x <= b.maxX && point.y >= b.minY && point.y <= b.maxY) {
      hitChild = child;
      break;
    }
  }

  const selectedChild = hitChild ?? children[children.length - 1]!;
  board.select([selectedChild.id]);
  return { enteredGroupId: groupEl.id, childId: selectedChild.id };
}

/**
 * Collects all descendants of given container IDs (groups and frames).
 *
 * @beta
 */
export function collectContainerDescendants(
  board: Board,
  rootIds: Iterable<string>,
): Readonly<ElementRecord>[] {
  const result: Readonly<ElementRecord>[] = [];
  const queue: string[] = [...rootIds];
  const visited = new Set<string>(rootIds);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = board.query({ parentId: currentId, allPages: true });
    for (const child of children) {
      if (!visited.has(child.id)) {
        visited.add(child.id);
        result.push(child);
        if (child.type === 'group' || child.type === 'frame') {
          queue.push(child.id);
        }
      }
    }
  }

  return result;
}

function isDescendant(board: Board, potentialChildId: string, parentId: string): boolean {
  let curr = board.getElement(potentialChildId)?.parentId ?? null;
  const visited = new Set<string>();
  while (curr !== null && !visited.has(curr)) {
    if (curr === parentId) return true;
    visited.add(curr);
    curr = board.getElement(curr)?.parentId ?? null;
  }
  return false;
}

/**
 * Reparents moved elements to frames: sets `parentId` when dropped inside a frame,
 * or clears it to `null` when dragged outside (BOARD-1105).
 *
 * Enforces the 1-level frame nesting limit: a frame containing other frames cannot
 * be nested into another frame.
 *
 * @beta
 */
export function reparentElementsToFrames(board: Board, movedIds: readonly string[]): void {
  if (board.readOnly || movedIds.length === 0) return;

  const movedElements = movedIds
    .map((id) => board.getElement(id))
    .filter((el): el is Readonly<ElementRecord> => el !== undefined && !el.locked);

  const candidateFrames = board
    .query({ type: 'frame' })
    .filter((f) => !f.locked);

  board.transact(() => {
    for (const el of movedElements) {
      // Elements whose parent is a group stay with their group
      if (el.parentId !== null) {
        const currentParent = board.getElement(el.parentId);
        if (currentParent && currentParent.type === 'group') continue;
      }

      // Check frame nesting constraints
      if (el.type === 'frame') {
        const hasChildFrames = board
          .query({ pageId: el.pageId, parentId: el.id })
          .some((c) => c.type === 'frame');
        if (hasChildFrames) {
          // Cannot nest into another frame
          if (el.parentId !== null) {
            board.update(el.id, { parentId: null });
          }
          continue;
        }
      }

      const centerX = el.x + el.w / 2;
      const centerY = el.y + el.h / 2;

      // Find candidate frame containing center of element
      const matchingFrames = candidateFrames.filter((f) => {
        if (f.id === el.id || f.pageId !== el.pageId) return false;
        if (isDescendant(board, f.id, el.id)) return false;
        if (el.type === 'frame' && f.parentId !== null) return false; // 1-level nesting max

        return (
          centerX >= f.x &&
          centerX <= f.x + f.w &&
          centerY >= f.y &&
          centerY <= f.y + f.h
        );
      });

      if (matchingFrames.length > 0) {
        // Pick topmost frame (children before parents, then higher index)
        matchingFrames.sort((a, b) => {
          if (a.parentId === b.id) return 1;
          if (b.parentId === a.id) return -1;
          return compareIndex(b.index, a.index);
        });

        const targetFrame = matchingFrames[0]!;
        if (el.parentId !== targetFrame.id) {
          board.update(el.id, { parentId: targetFrame.id });
        }
      } else if (el.parentId !== null) {
        const currentParent = board.getElement(el.parentId);
        if (currentParent && currentParent.type === 'frame') {
          board.update(el.id, { parentId: null });
        }
      }
    }
  });
}
