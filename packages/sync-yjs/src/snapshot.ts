/**
 * Version snapshots (BOARD-1511): encode the board content as bytes the application stores, preview
 * a snapshot without touching the board, and restore it as a new, undoable, synced change.
 *
 * A snapshot holds the document content only (records and document metadata), written into a fresh
 * `Y.Doc` and encoded as a Yjs update: no edit history, no tombstones, no client IDs of the source
 * document. That keeps snapshots small, works with Yjs garbage collection (`Y.snapshot` needs
 * `gc: false`), and lets a snapshot be restored into any document.
 *
 * @packageDocumentation
 */

import * as Y from 'yjs';
import { ReadOnlyBoardError, type Board, type BoardDocument } from '@kujam/core';
import {
  documentToUpdate,
  updateToDocument,
  yDocToDocument,
  type UpdateToDocumentOptions,
} from './document.js';

/**
 * Options for {@link decodeSnapshot}.
 *
 * @public
 */
export type DecodeSnapshotOptions = UpdateToDocumentOptions;

/**
 * Options for `YjsSyncAdapter.restoreSnapshot` (BOARD-1511).
 *
 * @public
 */
export interface RestoreSnapshotOptions {
  /** Undo history label of the restore step. Defaults to `'snapshot.restore'`. */
  readonly label?: string;
}

/**
 * Summary of a snapshot restore (BOARD-1511).
 *
 * @public
 */
export interface RestoreSnapshotResult {
  /** IDs of records added or changed to match the snapshot. */
  readonly updated: readonly string[];
  /** IDs of records removed because the snapshot does not have them. */
  readonly removed: readonly string[];
  /** Snapshot records dropped as invalid for this board (see `Board.prepareDocument`). */
  readonly rejected: readonly { readonly id: string; readonly errors: readonly string[] }[];
}

/**
 * Default undo history label of a snapshot restore (BOARD-1511).
 *
 * @public
 */
export const RESTORE_SNAPSHOT_LABEL = 'snapshot.restore';

/**
 * Encodes the content of a `Y.Doc` or a {@link BoardDocument} as a version snapshot (BOARD-1511):
 * binary bytes the application can store anywhere (database blob, file, object storage).
 *
 * @param source - Shared `Y.Doc` (for example `adapter.doc`) or a board document.
 * @returns Snapshot bytes; decode them with {@link decodeSnapshot}.
 * @public
 */
export function encodeSnapshot(source: Y.Doc | BoardDocument): Uint8Array {
  const document = source instanceof Y.Doc ? yDocToDocument(source) : source;
  return documentToUpdate(document);
}

/**
 * Decodes snapshot bytes into a board document for a read-only preview, without touching any
 * board or `Y.Doc` (BOARD-1511). Untrusted bytes are safe: the size is checked before decoding and
 * corrupt bytes throw `InvalidUpdateError`. Pass `registry` and `limits` (for example
 * `board.elements` and `board.limits`) to drop records the board would reject.
 *
 * Show the preview on a separate board: `createBoard({ document, readOnly: true })`.
 *
 * @throws `InvalidUpdateError` when the bytes are too large or corrupt, or `InvalidDocumentError`
 *   when the decoded document exceeds the limits.
 * @public
 */
export function decodeSnapshot(
  bytes: Uint8Array,
  options: DecodeSnapshotOptions = {},
): BoardDocument {
  return updateToDocument(bytes, options);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality for JSON record values, ignoring key order. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a).filter((k) => a[k] !== undefined);
    const otherKeys = Object.keys(b).filter((k) => b[k] !== undefined);
    return keys.length === otherKeys.length && keys.every((k) => jsonEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Applies a decoded snapshot to a connected board as one local transaction: records that differ
 * are put, records missing from the snapshot are removed. Unchanged records are not written, so
 * concurrent edits by others on them are untouched.
 *
 * @internal
 */
export function applySnapshot(
  board: Board,
  snapshot: BoardDocument,
  label: string,
): RestoreSnapshotResult {
  if (board.readOnly) throw new ReadOnlyBoardError();
  const prepared = board.prepareDocument(snapshot);
  if (prepared.tooNew) {
    throw new Error('Snapshot lebih baru dari yang didukung papan ini dan tidak bisa dipulihkan.');
  }
  const target = prepared.document.records;
  const updated: string[] = [];
  const removed: string[] = [];
  board.transact(
    (tx) => {
      const current = board.getDocument().records;
      for (const record of Object.values(target)) {
        const existing = Object.hasOwn(current, record.id) ? current[record.id] : undefined;
        if (existing && jsonEqual(existing, record)) continue;
        tx.put(record);
        updated.push(record.id);
      }
      for (const id of Object.keys(current)) {
        if (!Object.hasOwn(target, id)) {
          tx.remove(id);
          removed.push(id);
        }
      }
    },
    { label },
  );
  return Object.freeze({
    updated: Object.freeze(updated),
    removed: Object.freeze(removed),
    rejected: prepared.rejected,
  });
}
