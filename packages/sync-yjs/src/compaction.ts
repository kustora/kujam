/**
 * Yjs document size control (BOARD-1515): re-encoding stored state so it stays compact.
 *
 * Yjs garbage collection (`gc: true`, the Yjs default, kept by this package) replaces deleted
 * content with small placeholders in memory. Stored state, however, often grows: servers and
 * offline caches that append every incoming update keep each one, including content deleted later.
 * Loading those updates into a garbage-collected `Y.Doc` and encoding its state again merges them
 * into one update without the deleted content. The result has the same CRDT identity, so it is safe
 * to replace stored state with it while clients are connected.
 *
 * @packageDocumentation
 */

import * as Y from 'yjs';
import { DEFAULT_BOARD_LIMITS } from '@kujam/core';
import { InvalidUpdateError } from './document.js';

/**
 * Options for {@link compactUpdate}.
 *
 * @public
 */
export interface CompactUpdateOptions {
  /**
   * Largest accepted total input in bytes, checked before decoding (BOARD-2004). Defaults to
   * `DEFAULT_BOARD_LIMITS.maxDocumentBytes` (10 MB).
   */
  readonly maxUpdateBytes?: number;
}

/**
 * Merges one or more stored Yjs updates into a single compact update (BOARD-1515): applies them
 * to a fresh garbage-collected `Y.Doc` and encodes its state again, or keeps Yjs' plain merge of
 * the updates when that is smaller (edits with little deleted content). Deleted content is dropped;
 * the document identity is kept, so connected clients and offline caches merge with the result
 * normally. Run it periodically on the server, for example when a document is stored or unloaded.
 *
 * @param updates - One update, or a list of updates (for example an append-only update log).
 * @returns The compacted state update, never larger than the input merged as is.
 * @throws {@link InvalidUpdateError} when the input is too large or corrupt.
 * @public
 */
export function compactUpdate(
  updates: Uint8Array | readonly Uint8Array[],
  options: CompactUpdateOptions = {},
): Uint8Array {
  const list = updates instanceof Uint8Array ? [updates] : [...updates];
  const max = options.maxUpdateBytes ?? DEFAULT_BOARD_LIMITS.maxDocumentBytes;
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError('maxUpdateBytes wajib berupa bilangan bulat positif.');
  }
  let total = 0;
  for (const update of list) {
    if (!(update instanceof Uint8Array)) {
      throw new TypeError('update wajib berupa Uint8Array.');
    }
    total += update.byteLength;
  }
  if (total > max) {
    throw new InvalidUpdateError(
      `Ukuran update Yjs (${total} byte) melebihi batas maksimum (${max} byte).`,
    );
  }
  const doc = new Y.Doc({ gc: true });
  try {
    doc.transact(() => {
      for (const update of list) Y.applyUpdate(doc, update);
    });
    const reencoded = Y.encodeStateAsUpdate(doc);
    // Without deletions to drop, Yjs' plain merge can be the tighter encoding of the same state.
    const merged = list.length === 1 ? list[0]! : Y.mergeUpdates(list);
    return merged.byteLength < reencoded.byteLength ? merged : reencoded;
  } catch (error) {
    throw new InvalidUpdateError('Update Yjs rusak dan tidak bisa dipadatkan.', { cause: error });
  } finally {
    doc.destroy();
  }
}
