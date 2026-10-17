/**
 * Pages in the board data model (BOARD-208).
 *
 * Pages are `page` records in the document, ordered by fractional `index`. The current page is
 * local UI state, like the camera and selection: it is not saved and not recorded in undo history.
 * `board.query`, `board.hitTest`, `board.create`, and the selection default to the current page.
 */

import { compareIndex, indexAbove } from '../document/indexing.js';
import type { MutateOptions } from '../document/mutate.js';
import type { PermissionAction } from '../plugins/plugins.js';
import type { BoardErrorCode, PageEvent } from '../events/events.js';
import type { ChangeEvent, Transaction, TransactOptions } from '../document/store.js';
import type { BoardDocument, ElementRecord, PageRecord } from '../types.js';

/**
 * Input for `board.pages.create`. Omitted fields get defaults.
 *
 * @beta
 */
export interface PageInput {
  /** Record ID; when omitted, generated with the board's ID generator. */
  readonly id?: string;
  /** Display name; defaults to `'Halaman N'`. */
  readonly name?: string;
  /** Page order index; defaults to after the last page. */
  readonly index?: string;
  /** Free-form consumer metadata; defaults to `{}`. */
  readonly meta?: Record<string, unknown>;
}

/**
 * Page API of a board (`board.pages`, BOARD-208).
 *
 * Page changes run through the permission hook with the actions `'page.create'`,
 * `'page.rename'`, and `'page.delete'` (element `null`); deleting a page also checks `'delete'`
 * for every element on it.
 *
 * @beta
 */
export interface BoardPages {
  /**
   * ID of the current page. Defaults to the first page by `index`. When the current page is
   * deleted (by any origin), the board moves to the neighboring page.
   */
  readonly current: string;
  /** All pages, sorted by `index`. */
  list(): readonly Readonly<PageRecord>[];
  /** The page with the ID, or `undefined` when it does not exist. */
  get(id: string): Readonly<PageRecord> | undefined;
  /**
   * Adds a page after the last one (or at `page.index`). Does not change the current page.
   *
   * @returns The new page, or `undefined` when rejected by the permission hook.
   * @throws `TypeError` for invalid input, `Error` when the ID is already in use or after `dispose`.
   */
  create(page?: PageInput, options?: MutateOptions): Readonly<PageRecord> | undefined;
  /**
   * Renames a page.
   *
   * @returns The updated page, or `undefined` when the page does not exist or the permission hook
   *   rejects the change.
   */
  rename(id: string, name: string, options?: MutateOptions): Readonly<PageRecord> | undefined;
  /**
   * Deletes a page together with all its elements and their bindings, as a single transaction.
   * Locked elements are deleted too. The last page cannot be deleted.
   *
   * @returns IDs of the deleted records (the page last), or an empty list when the page does not
   *   exist or the permission hook rejects the page or any of its elements (nothing is deleted).
   * @throws `Error` when `id` is the only page, or after `dispose`.
   */
  delete(id: string, options?: MutateOptions): readonly string[];
  /**
   * Switches the current page and clears the selection. Emits a `page` event when the page
   * actually changes. Allowed on `readOnly` boards.
   *
   * @throws `Error` when the page does not exist, or after `dispose`.
   */
  setCurrent(id: string): void;
}

/** @internal */
export interface PagesOptions {
  getDocument(): Readonly<BoardDocument>;
  transact<T>(fn: (tx: Transaction) => T, options?: TransactOptions): T;
  createId(): string;
  checkPermission(action: PermissionAction, element: Readonly<ElementRecord> | null): boolean;
  /** Deletes elements as part of the current transaction; empty when rejected. */
  deleteElements(
    ids: readonly string[],
    options: MutateOptions & { force: true },
  ): readonly string[];
  emitError(code: BoardErrorCode, message: string, cause: unknown): void;
  assertUsable(): void;
  /** Called after the current page changed, before the `page` event. */
  onCurrentChange(event: PageEvent): void;
}

/** @internal */
export interface PagesRuntime {
  readonly api: BoardPages;
  /** Moves off a page that no longer exists after a document change. */
  observe(event: ChangeEvent): void;
}

function sortedPages(doc: Readonly<BoardDocument>): Readonly<PageRecord>[] {
  const pages: PageRecord[] = [];
  for (const rec of Object.values(doc.records)) {
    if (rec.kind === 'page') pages.push(rec);
  }
  return pages.sort((a, b) => compareIndex(a.index, b.index) || (a.id < b.id ? -1 : 1));
}

function getPage(doc: Readonly<BoardDocument>, id: string): Readonly<PageRecord> | undefined {
  const rec = Object.hasOwn(doc.records, id) ? doc.records[id] : undefined;
  return rec?.kind === 'page' ? rec : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @internal */
export function createPages(options: PagesOptions): PagesRuntime {
  const first = sortedPages(options.getDocument())[0];
  let current = first?.id ?? 'page:main';
  /** Last known page order, to find the neighbor of a page deleted by a remote change. */
  let order = sortedPages(options.getDocument()).map((p) => p.id);

  function switchTo(id: string): void {
    if (id === current) return;
    const previous = current;
    current = id;
    options.onCurrentChange(Object.freeze({ id, previous }));
  }

  /** The page after `id` in `ids`, or the one before it when it was last. */
  function neighbor(ids: readonly string[], id: string, exists: (id: string) => boolean): string {
    const at = ids.indexOf(id);
    for (let i = at + 1; i < ids.length; i++) if (exists(ids[i]!)) return ids[i]!;
    for (let i = at - 1; i >= 0; i--) if (exists(ids[i]!)) return ids[i]!;
    return sortedPages(options.getDocument())[0]?.id ?? id;
  }

  function forbidden(action: PermissionAction, id: string): undefined {
    options.emitError(
      'forbidden',
      `Operasi "${action}" pada halaman "${id}" ditolak oleh hook izin.`,
      {
        action,
        pageId: id,
      },
    );
    return undefined;
  }

  const api: BoardPages = {
    get current() {
      return current;
    },
    list() {
      return Object.freeze(sortedPages(options.getDocument()));
    },
    get(id) {
      return getPage(options.getDocument(), id);
    },
    create(input = {}, mutateOptions) {
      options.assertUsable();
      if (!isPlainObject(input)) {
        throw new TypeError('Argumen page pada board.pages.create wajib berupa objek.');
      }
      if (input.name !== undefined && typeof input.name !== 'string') {
        throw new TypeError('page.name wajib berupa string.');
      }
      if (input.index !== undefined && (typeof input.index !== 'string' || input.index === '')) {
        throw new TypeError('page.index wajib berupa string tidak kosong.');
      }
      if (input.meta !== undefined && !isPlainObject(input.meta)) {
        throw new TypeError('page.meta wajib berupa objek.');
      }
      const doc = options.getDocument();
      const id =
        typeof input.id === 'string' && input.id.length > 0 ? input.id : options.createId();
      if (Object.hasOwn(doc.records, id)) {
        throw new Error(`ID "${id}" sudah dipakai record lain.`);
      }
      const pages = sortedPages(doc);
      const page: PageRecord = {
        id,
        kind: 'page',
        name: input.name ?? `Halaman ${pages.length + 1}`,
        index: input.index ?? indexAbove(pages.at(-1)?.index ?? null),
        meta: { ...(input.meta ?? {}) },
      };
      if (!options.checkPermission('page.create', null)) return forbidden('page.create', id);
      options.transact((tx) => tx.put(page), {
        label: mutateOptions?.label ?? 'page.create',
        origin: mutateOptions?.origin,
      });
      return getPage(options.getDocument(), id);
    },
    rename(id, name, mutateOptions) {
      options.assertUsable();
      if (typeof name !== 'string') {
        throw new TypeError('Argumen name pada board.pages.rename wajib berupa string.');
      }
      const page = getPage(options.getDocument(), id);
      if (!page) return undefined;
      if (page.name === name) return page;
      if (!options.checkPermission('page.rename', null)) return forbidden('page.rename', id);
      options.transact((tx) => tx.put({ ...page, name }), {
        label: mutateOptions?.label ?? 'page.rename',
        origin: mutateOptions?.origin,
      });
      return getPage(options.getDocument(), id);
    },
    delete(id, mutateOptions) {
      options.assertUsable();
      const doc = options.getDocument();
      const page = getPage(doc, id);
      if (!page) return Object.freeze([]);
      if (sortedPages(doc).length === 1) {
        throw new Error(
          'Halaman terakhir tidak bisa dihapus; papan wajib memiliki minimal satu halaman.',
        );
      }
      if (!options.checkPermission('page.delete', null)) {
        forbidden('page.delete', id);
        return Object.freeze([]);
      }
      const elementIds: string[] = [];
      for (const rec of Object.values(doc.records)) {
        if (rec.kind === 'element' && rec.pageId === id) elementIds.push(rec.id);
      }
      const label = mutateOptions?.label ?? 'page.delete';
      const origin = mutateOptions?.origin;
      return options.transact(
        (tx) => {
          let deleted: readonly string[] = [];
          if (elementIds.length > 0) {
            deleted = options.deleteElements(elementIds, { label, origin, force: true });
            // Rejected by the permission hook (already reported): keep the page and its elements.
            if (deleted.length === 0) return Object.freeze([]);
          }
          tx.remove(id);
          return Object.freeze([...deleted, id]);
        },
        { label, origin },
      );
    },
    setCurrent(id) {
      options.assertUsable();
      if (typeof id !== 'string' || !getPage(options.getDocument(), id)) {
        throw new Error(`Halaman "${String(id)}" tidak ditemukan.`);
      }
      switchTo(id);
    },
  };

  return {
    api,
    observe(event) {
      const touchesPages =
        event.origin === 'load' ||
        Object.values(event.added).some((rec) => rec.kind === 'page') ||
        Object.values(event.removed).some((rec) => rec.kind === 'page') ||
        Object.values(event.updated).some(
          (u) => u.before.kind === 'page' || u.after.kind === 'page',
        );
      if (!touchesPages) return;
      const doc = options.getDocument();
      const exists = (pageId: string): boolean => getPage(doc, pageId) !== undefined;
      if (!exists(current)) {
        const ids = event.origin === 'load' ? sortedPages(doc).map((p) => p.id) : order;
        switchTo(neighbor(ids, current, exists));
      }
      order = sortedPages(doc).map((p) => p.id);
    },
  };
}
