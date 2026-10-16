/**
 * Implementasi API perubahan tingkat tinggi: create, update, delete (BOARD-205).
 *
 * Mengisi nilai bawaan, mengkalkulasi fractional index di atas elemen teratas page,
 * menggabungkan props per kunci, cascade delete anak dan binding, serta memvalidasi props.
 */

import { compareIndex, indexAbove } from './indexing.js';
import type { ElementRegistry } from './elements.js';
import type { BoardErrorCode } from './events.js';
import type { ChangeOrigin, TransactOptions, Transaction } from './store.js';
import type { BoardDocument, ElementRecord } from './types.js';

/**
 * Opsi mutasi tingkat tinggi (`board.create`, `board.update`, `board.delete`).
 *
 * @public
 */
export interface MutateOptions {
  /** Label transaksi untuk undo dan log; bawaan sesuai nama operasi. */
  readonly label?: string;
  /** Asal perubahan; bawaan `'local'`. */
  readonly origin?: ChangeOrigin;
}

/**
 * Opsi `board.update`.
 *
 * @public
 */
export interface UpdateOptions extends MutateOptions {
  /**
   * Bila `true`, mengizinkan perubahan elemen yang sedang `locked` (misalnya perintah buka kunci).
   * Bawaan `false`.
   */
  readonly force?: boolean;
}

/**
 * Opsi `board.delete`.
 *
 * @public
 */
export interface DeleteOptions extends MutateOptions {
  /**
   * Bila `true`, mengizinkan penghapusan elemen yang sedang `locked`.
   * Bawaan `false`.
   */
  readonly force?: boolean;
}

/**
 * Data elemen masukan untuk `board.create`. Field yang tidak diisi akan dilengkapi nilai bawaan.
 *
 * @public
 */
export interface PartialElement<P = Record<string, unknown>> {
  /** Tipe elemen yang terdaftar di `board.elements`. Wajib diisi. */
  readonly type: string;
  /** ID record; bila kosong dibuat dengan generator ID papan. */
  readonly id?: string;
  /** ID halaman target; bila kosong memakai halaman pertama di dokumen. */
  readonly pageId?: string;
  /** ID kontainer (frame atau grup); bawaan `null`. */
  readonly parentId?: string | null;
  /** Index urutan lapisan; bila kosong dihitung di atas elemen teratas di halaman. */
  readonly index?: string;
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly w?: number;
  readonly h?: number;
  readonly locked?: boolean;
  readonly opacity?: number;
  /** Props khusus tipe; digabung dangkal di atas `defaults` definisi tipe. */
  readonly props?: Partial<P>;
  /** Metadata bebas milik pemakai; bawaan `{}`. */
  readonly meta?: Record<string, unknown>;
}

/**
 * Perubahan sebagian elemen untuk `board.update`. Field yang tidak diisi tidak diubah.
 *
 * @public
 */
export interface ElementPatch<P = Record<string, unknown>> {
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
  /** Props yang diubah; digabung per kunci dengan props yang sudah ada. */
  readonly props?: Partial<P>;
  /** Metadata bebas; digabung dangkal dengan meta yang sudah ada. */
  readonly meta?: Record<string, unknown>;
}

/** @internal */
export interface MutationLimits {
  readonly maxElements: number;
}

/** @internal */
export interface MutationContext {
  getDocument(): Readonly<BoardDocument>;
  getElement(id: string): Readonly<ElementRecord> | undefined;
  transact<T>(fn: (tx: Transaction) => T, options?: TransactOptions): T;
  readonly elements: ElementRegistry;
  readonly limits: MutationLimits;
  createId(): string;
  emitError(code: BoardErrorCode, message: string, cause: unknown): void;
  assertUsable(): void;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveDefaultPageId(doc: Readonly<BoardDocument>): string {
  for (const rec of Object.values(doc.records)) {
    if (rec.kind === 'page') return rec.id;
  }
  return 'page:main';
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

/**
 * Membuat elemen baru dan menyimpannya ke papan (BOARD-205).
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

  const validation = ctx.elements.validateElementProps(partial.type, mergedProps);
  if (validation && !validation.ok) {
    ctx.emitError(
      'invalid-props',
      `Props elemen "${partial.type}" tidak lolos skema tipe.`,
      validation.issues,
    );
    return undefined;
  }

  const pageId = partial.pageId ?? resolveDefaultPageId(doc);
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
    meta: { ...(partial.meta ?? {}) },
  };

  ctx.transact(
    (tx) => {
      tx.put(element as ElementRecord);
    },
    {
      label: options?.label ?? 'create',
      origin: options?.origin ?? 'local',
    },
  );

  return ctx.getElement(id) as Readonly<ElementRecord<P>> | undefined;
}

/**
 * Memperbarui elemen yang sudah ada di papan (BOARD-205).
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

  let nextProps = current.props;
  if (patch.props !== undefined) {
    nextProps = { ...current.props, ...patch.props };
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
    },
  );

  return ctx.getElement(id) as Readonly<ElementRecord<P>> | undefined;
}

/**
 * Menghapus elemen beserta anak dan binding yang menempel (BOARD-205).
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

  // Cascade anak-anak (frame / grup) secara rekursif
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

  // Cascade binding yang menempel ke elemen yang dihapus
  for (const [id, rec] of Object.entries(doc.records)) {
    if (rec.kind === 'binding') {
      if (toDelete.has(rec.fromId) || toDelete.has(rec.toId)) {
        toDelete.add(id);
      }
    }
  }

  const deletedList = Array.from(toDelete);
  ctx.transact(
    (tx) => {
      for (const id of deletedList) {
        tx.remove(id);
      }
    },
    {
      label: options?.label ?? 'delete',
      origin: options?.origin ?? 'local',
    },
  );

  return Object.freeze(deletedList);
}
