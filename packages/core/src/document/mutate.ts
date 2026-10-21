/**
 * High-level mutation API implementation: create, update, delete (BOARD-205).
 *
 * Fills in default values, computes a fractional index above the page's top element,
 * merges props per key, cascades deletes to children and bindings, and validates props.
 */

import { compareIndex, indexAbove } from './indexing.js';
import { countPoints } from './limits.js';
import type { ElementRegistry } from '../elements/elements.js';
import type { BoardErrorCode } from '../events/events.js';
import type { BoardUser, PermissionAction } from '../plugins/plugins.js';
import type { ChangeOrigin, TransactOptions, Transaction } from './store.js';
import type { BoardDocument, ElementRecord } from '../types.js';

/**
 * High-level mutation options (`board.create`, `board.update`, `board.delete`).
 *
 * @public
 */
export interface MutateOptions {
  /** Transaction label for undo and logs; defaults to the operation name. */
  readonly label?: string;
  /** Change origin; defaults to `'local'`. */
  readonly origin?: ChangeOrigin;
  /** Undo merge key (BOARD-302); see {@link TransactOptions.mergeKey}. */
  readonly mergeKey?: string;
}

/**
 * Options for `board.update`.
 *
 * @public
 */
export interface UpdateOptions extends MutateOptions {
  /**
   * When `true`, allows changing an element that is `locked` (for example an unlock command).
   * Defaults to `false`.
   */
  readonly force?: boolean;
}

/**
 * Options for `board.delete`.
 *
 * @public
 */
export interface DeleteOptions extends MutateOptions {
  /**
   * When `true`, allows deleting an element that is `locked`.
   * Defaults to `false`.
   */
  readonly force?: boolean;
}

/**
 * Options for `board.replaceElements` (BOARD-606).
 *
 * @public
 */
export interface ReplaceElementsOptions extends MutateOptions {
  /**
   * When `true`, allows replacing an element that is `locked`.
   * Defaults to `false`.
   */
  readonly force?: boolean;
  /**
   * Selection behavior after replacement.
   * - `true`: explicitly select the newly created elements.
   * - `false`: do not alter the current selection.
   * - `undefined`: if the replaced element was selected, substitute it in place.
   */
  readonly select?: boolean;
}

/**
 * Input element data for `board.replaceElements` (BOARD-606). Omitted fields
 * inherit from the element being replaced (`x, y, w, h, parentId, pageId, index`).
 *
 * @public
 */
export interface ElementInput<P = Record<string, unknown>> {
  /** Element type registered in `board.elements`. Required. */
  readonly type: string;
  /** Record ID; when omitted, a new unique ID is generated. */
  readonly id?: string;
  readonly pageId?: string;
  readonly parentId?: string | null;
  readonly index?: string;
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly w?: number;
  readonly h?: number;
  readonly locked?: boolean;
  readonly opacity?: number;
  /** Type-specific props; shallow-merged on top of the type definition's `defaults`. */
  readonly props?: Partial<P>;
  /** Free-form consumer metadata; defaults to a copy of the old element's meta. */
  readonly meta?: Record<string, unknown>;
}

/**
 * Factory callback for replacing an element (BOARD-606). Can return synchronously or a Promise.
 *
 * @public
 */
export type ReplaceElementFactory<P = Record<string, unknown>> = (
  oldElement: Readonly<ElementRecord>,
) => ElementInput<P> | Promise<ElementInput<P>>;

/**
 * Input element data for `board.create`. Omitted fields are filled with default values.
 *
 * @public
 */
export interface PartialElement<P = Record<string, unknown>> {
  /** Element type registered in `board.elements`. Required. */
  readonly type: string;
  /** Record ID; when omitted, generated with the board's ID generator. */
  readonly id?: string;
  /**
   * Target page ID; when omitted, the current page (`board.pages.current`) is used. Must be an
   * existing page, otherwise `create` emits `page-not-found` and returns `undefined`.
   */
  readonly pageId?: string;
  /** Container ID (frame or group); defaults to `null`. */
  readonly parentId?: string | null;
  /** Layer order index; when omitted, computed above the top element on the page. */
  readonly index?: string;
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly w?: number;
  readonly h?: number;
  readonly locked?: boolean;
  readonly opacity?: number;
  /** Type-specific props; shallow-merged on top of the type definition's `defaults`. */
  readonly props?: Partial<P>;
  /** Free-form consumer metadata; defaults to `{}`. */
  readonly meta?: Record<string, unknown>;
}

/**
 * Partial element change for `board.update`. Omitted fields are left unchanged.
 *
 * @public
 */
export interface ElementPatch<P = Record<string, unknown>> {
  /**
   * Moves the element to another page. Must be an existing page, otherwise `update` emits
   * `page-not-found` and returns `undefined`.
   */
  readonly pageId?: string;
  readonly parentId?: string | null;
  readonly index?: string;
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly w?: number;
  readonly h?: number;
  readonly locked?: boolean;
  readonly opacity?: number;
  /** Changed props; merged per key with the existing props. Rejected for unregistered types. */
  readonly props?: Partial<P>;
  /** Free-form metadata; shallow-merged with the existing meta. */
  readonly meta?: Record<string, unknown>;
}

/** @internal */
export interface MutationLimits {
  readonly maxElements: number;
  readonly maxDrawPoints: number;
}

/** @internal */
export interface MutationContext {
  getDocument(): Readonly<BoardDocument>;
  getElement(id: string): Readonly<ElementRecord> | undefined;
  transact<T>(fn: (tx: Transaction) => T, options?: TransactOptions): T;
  readonly elements: ElementRegistry;
  readonly limits: MutationLimits;
  readonly user: Readonly<BoardUser> | null;
  checkPermission(action: PermissionAction, element: Readonly<ElementRecord> | null): boolean;
  /** Page for new elements without `pageId`: the current page (BOARD-208). */
  defaultPageId(): string;
  createId(): string;
  emitError(code: BoardErrorCode, message: string, cause: unknown): void;
  assertUsable(): void;
  getSelection?(): readonly string[];
  select?(ids: readonly string[]): void;
  isReplacing?(id: string): boolean;
  setReplacing?(id: string, replacing: boolean): void;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function findTopIndexOnPage(doc: Readonly<BoardDocument>, pageId: string): string | null {
  let top: string | null = null;
  for (const rec of Object.values(doc.records)) {
    if (rec.kind === 'element' && rec.pageId === pageId) {
      if (top === null || compareIndex(rec.index, top) > 0) {
        top = rec.index;
      }
    }
  }
  return top;
}

/** Emits `limit-exceeded` and returns `false` when `props.points` exceeds `maxDrawPoints` (BOARD-210). */
function withinPointLimit(ctx: MutationContext, type: string, props: unknown): boolean {
  const points = countPoints(props);
  if (points <= ctx.limits.maxDrawPoints) return true;
  ctx.emitError(
    'limit-exceeded',
    `Elemen "${type}" berisi ${points} titik, melebihi batas maksimum (${ctx.limits.maxDrawPoints}).`,
    { limit: ctx.limits.maxDrawPoints, current: points, type },
  );
  return false;
}

/**
 * Whether `pageId` is an existing page; emits `page-not-found` when not. An element on a missing page
 * would never be visible and never removed by a page delete (BOARD-208).
 */
function pageExists(ctx: MutationContext, doc: Readonly<BoardDocument>, pageId: string): boolean {
  const page = Object.hasOwn(doc.records, pageId) ? doc.records[pageId] : undefined;
  if (page?.kind === 'page') return true;
  ctx.emitError('page-not-found', `Page "${pageId}" tidak ditemukan.`, { pageId });
  return false;
}

/**
 * Creates a new element and stores it on the board (BOARD-205).
 *
 * @internal
 */
export function createElementRecord<P = Record<string, unknown>>(
  ctx: MutationContext,
  partial: PartialElement<P>,
  options?: MutateOptions,
): Readonly<ElementRecord<P>> | undefined {
  ctx.assertUsable();
  if (!isPlainObject(partial)) {
    throw new TypeError('Argumen partialElement pada board.create wajib berupa objek.');
  }
  if (typeof partial.type !== 'string' || partial.type.trim().length === 0) {
    throw new TypeError('partialElement.type wajib berupa string tidak kosong.');
  }

  const def = ctx.elements.get(partial.type);
  if (!def) {
    ctx.emitError('invalid-props', `Tipe elemen "${partial.type}" tidak terdaftar.`, {
      type: partial.type,
    });
    return undefined;
  }

  const doc = ctx.getDocument();

  let elementCount = 0;
  for (const rec of Object.values(doc.records)) {
    if (rec.kind === 'element') elementCount++;
  }
  if (elementCount >= ctx.limits.maxElements) {
    ctx.emitError(
      'limit-exceeded',
      `Jumlah elemen mencapai batas maksimum (${ctx.limits.maxElements}).`,
      { limit: ctx.limits.maxElements, current: elementCount },
    );
    return undefined;
  }

  const mergedProps = {
    ...(def.defaults ?? {}),
    ...(partial.props ?? {}),
  } as Record<string, unknown>;

  if (!withinPointLimit(ctx, partial.type, mergedProps)) return undefined;

  const validation = ctx.elements.validateElementProps(partial.type, mergedProps);
  if (validation && !validation.ok) {
    ctx.emitError(
      'invalid-props',
      `Props elemen "${partial.type}" tidak lolos skema tipe.`,
      validation.issues,
    );
    return undefined;
  }

  const pageId = partial.pageId ?? ctx.defaultPageId();
  if (!pageExists(ctx, doc, pageId)) return undefined;
  const index = partial.index ?? indexAbove(findTopIndexOnPage(doc, pageId));
  const id = typeof partial.id === 'string' && partial.id.length > 0 ? partial.id : ctx.createId();

  const element: ElementRecord<P> = {
    id,
    kind: 'element',
    type: partial.type,
    pageId,
    parentId: partial.parentId !== undefined ? partial.parentId : null,
    index,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    rotation: partial.rotation ?? 0,
    w: partial.w ?? 0,
    h: partial.h ?? 0,
    locked: partial.locked === true,
    opacity: partial.opacity !== undefined ? partial.opacity : 1,
    props: mergedProps as P,
    typeVersion: def.version,
    meta: { ...(partial.meta ?? {}) },
  };

  if (!ctx.checkPermission('create', element as unknown as ElementRecord)) {
    ctx.emitError(
      'forbidden',
      `Operasi "create" pada elemen bertipe "${element.type}" ditolak oleh hook izin.`,
      { action: 'create', element, user: ctx.user },
    );
    return undefined;
  }

  ctx.transact(
    (tx) => {
      tx.put(element as ElementRecord);
    },
    {
      label: options?.label ?? 'create',
      origin: options?.origin ?? 'local',
      mergeKey: options?.mergeKey,
    },
  );

  return ctx.getElement(id) as Readonly<ElementRecord<P>> | undefined;
}

/**
 * Updates an existing element on the board (BOARD-205).
 *
 * @internal
 */
export function updateElementRecord<P = Record<string, unknown>>(
  ctx: MutationContext,
  id: string,
  patch: ElementPatch<P>,
  options?: UpdateOptions,
): Readonly<ElementRecord<P>> | undefined {
  ctx.assertUsable();
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('id pada board.update wajib berupa string tidak kosong.');
  }
  if (!isPlainObject(patch)) {
    throw new TypeError('patch pada board.update wajib berupa objek.');
  }
  if (patch.props !== undefined && !isPlainObject(patch.props)) {
    throw new TypeError('patch.props pada board.update wajib berupa objek.');
  }

  const current = ctx.getElement(id);
  if (!current) return undefined;

  if (current.locked && options?.force !== true) {
    return undefined;
  }

  if (!ctx.checkPermission('update', current)) {
    ctx.emitError('forbidden', `Operasi "update" pada elemen "${id}" ditolak oleh hook izin.`, {
      action: 'update',
      element: current,
      user: ctx.user,
    });
    return undefined;
  }

  // Only a move is checked: an element already on a missing page can still be edited in place.
  if (
    patch.pageId !== undefined &&
    patch.pageId !== current.pageId &&
    !pageExists(ctx, ctx.getDocument(), patch.pageId)
  ) {
    return undefined;
  }

  let nextProps = current.props;
  if (patch.props !== undefined) {
    // Props of an unregistered type cannot be validated, so they are kept exactly as loaded
    // (BOARD-209); the element can still be moved, resized, locked, or deleted like a plain box.
    if (ctx.elements.get(current.type) === undefined) {
      ctx.emitError(
        'invalid-props',
        `Props elemen "${id}" bertipe "${current.type}" tidak bisa diubah karena tipenya tidak terdaftar.`,
        { id, type: current.type },
      );
      return undefined;
    }
    nextProps = { ...current.props, ...patch.props };
    if (!withinPointLimit(ctx, current.type, nextProps)) return undefined;
    const validation = ctx.elements.validateElementProps(current.type, nextProps);
    if (validation && !validation.ok) {
      ctx.emitError(
        'invalid-props',
        `Props elemen "${current.type}" tidak lolos skema tipe saat update.`,
        validation.issues,
      );
      return undefined;
    }
  }

  const updated: ElementRecord = {
    ...current,
    pageId: patch.pageId !== undefined ? patch.pageId : current.pageId,
    parentId: patch.parentId !== undefined ? patch.parentId : current.parentId,
    index: patch.index !== undefined ? patch.index : current.index,
    x: patch.x !== undefined ? patch.x : current.x,
    y: patch.y !== undefined ? patch.y : current.y,
    rotation: patch.rotation !== undefined ? patch.rotation : current.rotation,
    w: patch.w !== undefined ? patch.w : current.w,
    h: patch.h !== undefined ? patch.h : current.h,
    locked: patch.locked !== undefined ? patch.locked : current.locked,
    opacity: patch.opacity !== undefined ? patch.opacity : current.opacity,
    props: nextProps,
    meta: patch.meta !== undefined ? { ...current.meta, ...patch.meta } : current.meta,
  };

  ctx.transact(
    (tx) => {
      tx.put(updated);
    },
    {
      label: options?.label ?? 'update',
      origin: options?.origin ?? 'local',
      mergeKey: options?.mergeKey,
    },
  );

  return ctx.getElement(id) as Readonly<ElementRecord<P>> | undefined;
}

/**
 * Deletes elements together with their children and attached bindings (BOARD-205).
 *
 * @internal
 */
export function deleteElementRecords(
  ctx: MutationContext,
  ids: string | Iterable<string>,
  options?: DeleteOptions,
): readonly string[] {
  ctx.assertUsable();
  if (
    typeof ids !== 'string' &&
    (typeof ids !== 'object' ||
      ids === null ||
      typeof (ids as Iterable<unknown>)[Symbol.iterator] !== 'function')
  ) {
    throw new TypeError('ids pada board.delete wajib berupa string atau Iterable<string>.');
  }

  const targetIds = new Set<string>(typeof ids === 'string' ? [ids] : ids);
  if (targetIds.size === 0) return Object.freeze([]);

  const doc = ctx.getDocument();
  const toDelete = new Set<string>();

  for (const id of targetIds) {
    const rec = doc.records[id];
    if (!rec) continue;
    if (rec.kind === 'element' && rec.locked && options?.force !== true) {
      continue;
    }
    toDelete.add(id);
  }

  if (toDelete.size === 0) return Object.freeze([]);

  // Recursively cascade to children (frames / groups)
  let foundMore = true;
  while (foundMore) {
    foundMore = false;
    for (const [id, rec] of Object.entries(doc.records)) {
      if (
        rec.kind === 'element' &&
        rec.parentId &&
        toDelete.has(rec.parentId) &&
        !toDelete.has(id)
      ) {
        if (rec.locked && options?.force !== true) {
          continue;
        }
        toDelete.add(id);
        foundMore = true;
      }
    }
  }

  // Cascade to bindings attached to deleted elements
  for (const [id, rec] of Object.entries(doc.records)) {
    if (rec.kind === 'binding') {
      if (toDelete.has(rec.fromId) || toDelete.has(rec.toId)) {
        toDelete.add(id);
      }
    }
  }

  // Check delete permission for every element about to be deleted
  for (const id of toDelete) {
    const rec = doc.records[id];
    if (rec && rec.kind === 'element') {
      if (!ctx.checkPermission('delete', rec)) {
        ctx.emitError('forbidden', `Operasi "delete" pada elemen "${id}" ditolak oleh hook izin.`, {
          action: 'delete',
          element: rec,
          user: ctx.user,
        });
        return Object.freeze([]);
      }
    }
  }

  const deletedList = Array.from(toDelete);
  ctx.transact(
    (tx) => {
      for (const id of deletedList) {
        const rec = doc.records[id];
        if (rec && rec.kind === 'binding' && !toDelete.has(rec.fromId)) {
          const currentFrom = tx.get(rec.fromId);
          if (currentFrom && currentFrom.kind === 'element') {
            const props = currentFrom.props;
            const startMatch = props.startBindingId === id;
            const endMatch = props.endBindingId === id;
            if (startMatch || endMatch) {
              tx.put({
                ...currentFrom,
                props: {
                  ...props,
                  ...(startMatch ? { startBindingId: null } : {}),
                  ...(endMatch ? { endBindingId: null } : {}),
                },
              });
            }
          }
        }
        tx.remove(id);
      }
    },
    {
      label: options?.label ?? 'delete',
      origin: options?.origin ?? 'local',
      mergeKey: options?.mergeKey,
    },
  );

  return Object.freeze(deletedList);
}

/**
 * Replaces elements at the same position, size, container, page, and layer index,
 * repointing attached connector bindings in a single transaction (BOARD-606).
 *
 * @internal
 */
export function replaceElementRecords(
  ctx: MutationContext,
  ids: string | Iterable<string>,
  factory: ReplaceElementFactory,
  options?: ReplaceElementsOptions,
): readonly Readonly<ElementRecord>[] | Promise<readonly Readonly<ElementRecord>[]> {
  ctx.assertUsable();
  if (
    typeof ids !== 'string' &&
    (typeof ids !== 'object' ||
      ids === null ||
      typeof (ids as Iterable<unknown>)[Symbol.iterator] !== 'function')
  ) {
    throw new TypeError(
      'Argumen ids pada board.replaceElements wajib berupa string atau Iterable<string>.',
    );
  }
  if (typeof factory !== 'function') {
    throw new TypeError('Argumen factory pada board.replaceElements wajib berupa fungsi.');
  }

  const targetIds = new Set<string>(typeof ids === 'string' ? [ids] : ids);
  if (targetIds.size === 0) return Object.freeze([]);

  const doc = ctx.getDocument();
  const targets: ElementRecord[] = [];
  for (const id of targetIds) {
    const rec = doc.records[id];
    if (!rec || rec.kind !== 'element') continue;
    if (rec.locked && options?.force !== true) continue;
    targets.push(rec);
  }
  if (targets.length === 0) return Object.freeze([]);

  // Check permissions on the old elements before starting
  for (const target of targets) {
    if (!ctx.checkPermission('replace', target)) {
      ctx.emitError(
        'forbidden',
        `Operasi "replace" pada elemen "${target.id}" ditolak oleh hook izin.`,
        { action: 'replace', element: target, user: ctx.user },
      );
      return Object.freeze([]);
    }
    if (!ctx.checkPermission('update', target)) {
      ctx.emitError(
        'forbidden',
        `Operasi "update" pada elemen "${target.id}" ditolak oleh hook izin.`,
        { action: 'update', element: target, user: ctx.user },
      );
      return Object.freeze([]);
    }
    if (!ctx.checkPermission('delete', target)) {
      ctx.emitError(
        'forbidden',
        `Operasi "delete" pada elemen "${target.id}" ditolak oleh hook izin.`,
        { action: 'delete', element: target, user: ctx.user },
      );
      return Object.freeze([]);
    }
  }

  // Mark elements in transient replacing state
  for (const target of targets) {
    ctx.setReplacing?.(target.id, true);
  }

  let hasPromise = false;
  const factoryResults: (ElementInput | Promise<ElementInput>)[] = [];

  try {
    for (const target of targets) {
      const res = factory(target);
      if (res && typeof (res as Promise<unknown>).then === 'function') {
        hasPromise = true;
      }
      factoryResults.push(res);
    }
  } catch (err) {
    for (const target of targets) {
      ctx.setReplacing?.(target.id, false);
    }
    throw err;
  }

  function commitReplacements(
    targetsToCommit: ElementRecord[],
    inputs: ElementInput[],
  ): readonly Readonly<ElementRecord>[] {
    ctx.assertUsable();
    const currentDoc = ctx.getDocument();

    const validTargets: ElementRecord[] = [];
    const validInputs: ElementInput[] = [];

    for (let i = 0; i < targetsToCommit.length; i++) {
      const orig = targetsToCommit[i]!;
      const input = inputs[i]!;
      const current = currentDoc.records[orig.id];
      if (!current || current.kind !== 'element') continue;
      if (current.locked && options?.force !== true) continue;
      validTargets.push(current);
      validInputs.push(input);
    }

    if (validTargets.length === 0) return Object.freeze([]);

    const newElements: ElementRecord[] = [];
    const oldToNewId = new Map<string, string>();

    for (let i = 0; i < validTargets.length; i++) {
      const oldElement = validTargets[i]!;
      const input = validInputs[i]!;

      if (!isPlainObject(input)) {
        throw new TypeError('Nilai balik factory pada board.replaceElements wajib berupa objek.');
      }
      if (typeof input.type !== 'string' || input.type.trim().length === 0) {
        throw new TypeError('ElementInput.type wajib berupa string tidak kosong.');
      }

      const def = ctx.elements.get(input.type);
      if (!def) {
        ctx.emitError('invalid-props', `Tipe elemen "${input.type}" tidak terdaftar.`, {
          type: input.type,
        });
        return Object.freeze([]);
      }

      const mergedProps = {
        ...(def.defaults ?? {}),
        ...(input.props ?? {}),
      } as Record<string, unknown>;

      if (!withinPointLimit(ctx, input.type, mergedProps)) {
        return Object.freeze([]);
      }

      const validation = ctx.elements.validateElementProps(input.type, mergedProps);
      if (validation && !validation.ok) {
        ctx.emitError(
          'invalid-props',
          `Props elemen "${input.type}" tidak lolos skema tipe saat replace.`,
          validation.issues,
        );
        return Object.freeze([]);
      }

      const targetPageId = input.pageId !== undefined ? input.pageId : oldElement.pageId;
      if (!pageExists(ctx, currentDoc, targetPageId)) {
        return Object.freeze([]);
      }

      const targetX = input.x !== undefined ? input.x : oldElement.x;
      const targetY = input.y !== undefined ? input.y : oldElement.y;
      let targetW = input.w !== undefined ? input.w : oldElement.w;
      let targetH = input.h !== undefined ? input.h : oldElement.h;
      if (def.minSize) {
        targetW = Math.max(targetW, def.minSize.w ?? 0);
        targetH = Math.max(targetH, def.minSize.h ?? 0);
      }
      const targetRotation = input.rotation !== undefined ? input.rotation : oldElement.rotation;
      const targetLocked = input.locked !== undefined ? input.locked : oldElement.locked;
      const targetOpacity = input.opacity !== undefined ? input.opacity : oldElement.opacity;
      const targetParentId = input.parentId !== undefined ? input.parentId : oldElement.parentId;
      const targetIndex = input.index !== undefined ? input.index : oldElement.index;
      const targetMeta = input.meta !== undefined ? input.meta : { ...oldElement.meta };
      const newId = typeof input.id === 'string' && input.id.length > 0 ? input.id : ctx.createId();

      const newElement: ElementRecord = {
        id: newId,
        kind: 'element',
        type: input.type,
        pageId: targetPageId,
        parentId: targetParentId,
        index: targetIndex,
        x: targetX,
        y: targetY,
        rotation: targetRotation,
        w: targetW,
        h: targetH,
        locked: targetLocked,
        opacity: targetOpacity,
        props: mergedProps,
        typeVersion: def.version,
        meta: targetMeta,
      };

      if (!ctx.checkPermission('create', newElement)) {
        ctx.emitError(
          'forbidden',
          `Operasi "create" pada elemen bertipe "${newElement.type}" ditolak oleh hook izin.`,
          { action: 'create', element: newElement, user: ctx.user },
        );
        return Object.freeze([]);
      }

      newElements.push(newElement);
      oldToNewId.set(oldElement.id, newId);
    }

    // Snapshot selection prior to transaction so we know which old elements were selected
    const prevSelection = ctx.getSelection?.() ?? [];

    ctx.transact(
      (tx) => {
        // 1. Remove old elements
        for (const old of validTargets) {
          if (old.id !== oldToNewId.get(old.id)) {
            tx.remove(old.id);
          }
        }
        // 2. Put new elements
        for (const next of newElements) {
          tx.put(next);
        }
        // 3. Repoint connector bindings
        for (const rec of Object.values(currentDoc.records)) {
          if (rec.kind === 'binding') {
            const nextFromId = oldToNewId.get(rec.fromId) ?? rec.fromId;
            const nextToId = oldToNewId.get(rec.toId) ?? rec.toId;
            if (nextFromId !== rec.fromId || nextToId !== rec.toId) {
              tx.put({
                ...rec,
                fromId: nextFromId,
                toId: nextToId,
              });
            }
          }
        }
        // 4. Repoint container parentId for children
        for (const rec of Object.values(currentDoc.records)) {
          if (rec.kind === 'element' && rec.parentId && oldToNewId.has(rec.parentId)) {
            const newParentId = oldToNewId.get(rec.parentId)!;
            const newParent = tx.get(newParentId);
            if (
              newParent &&
              newParent.kind === 'element' &&
              (newParent.type === 'frame' || newParent.type === 'group')
            ) {
              tx.put({
                ...rec,
                parentId: newParentId,
              });
            } else {
              tx.put({
                ...rec,
                parentId: null,
              });
            }
          }
        }
      },
      {
        label: options?.label ?? 'replace',
        origin: options?.origin ?? 'local',
        mergeKey: options?.mergeKey,
      },
    );

    // Update selection
    if (options?.select === true) {
      ctx.select?.(newElements.map((e) => e.id));
    } else if (options?.select !== false) {
      let selectionChanged = false;
      const nextSelection = prevSelection.map((id) => {
        if (oldToNewId.has(id)) {
          selectionChanged = true;
          return oldToNewId.get(id)!;
        }
        return id;
      });
      if (selectionChanged) {
        ctx.select?.(nextSelection);
      }
    }

    const result: Readonly<ElementRecord>[] = [];
    for (const next of newElements) {
      const el = ctx.getElement(next.id);
      if (el) result.push(el);
    }
    return Object.freeze(result);
  }

  if (!hasPromise) {
    try {
      return commitReplacements(targets, factoryResults as ElementInput[]);
    } finally {
      for (const target of targets) {
        ctx.setReplacing?.(target.id, false);
      }
    }
  }

  return Promise.all(factoryResults)
    .then((resolvedInputs) => {
      return commitReplacements(targets, resolvedInputs);
    })
    .finally(() => {
      for (const target of targets) {
        ctx.setReplacing?.(target.id, false);
      }
    });
}
