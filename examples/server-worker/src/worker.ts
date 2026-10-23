/**
 * Board document worker on top of `@kujam/server` (BOARD-1805).
 *
 * The collaboration server stores the Yjs state of a board and calls {@link BoardWorker.enqueue}
 * after each save. Once a board has been quiet for `debounceMs`, the worker reads the latest state
 * and, in order:
 *
 * 1. validates it (`validateServerDocument`) and stops when it is invalid;
 * 2. extracts entity references (`extractReferences`) and reports which placements were added or
 *    removed since the previous run, so a placement index is updated by diff, not rewritten;
 * 3. renders a PNG thumbnail (`renderThumbnail`). Without `@napi-rs/canvas` (or a custom
 *    `canvasFactory`) the thumbnail is skipped and the application keeps the client thumbnail.
 *
 * Everything runs in plain Node without a DOM. Storage is behind {@link WorkerStore}, so the same
 * code works with SQLite, Postgres, or object storage.
 */

import type { AnyPluginDefinition } from '@kujam/core';
import {
  extractReferences,
  renderThumbnail,
  validateServerDocument,
  type CanvasFactory,
  type CardPlacementReference,
} from '@kujam/server';

/** Where the worker reads board states and writes its results. */
export interface WorkerStore {
  /** Latest Yjs state of a board, or `null` when the board no longer exists. */
  loadState(boardId: string): Promise<Uint8Array | null>;
  /** Placements stored by the previous run (empty the first time). */
  loadPlacements(boardId: string): Promise<readonly CardPlacementReference[]>;
  /** Applies a placement diff for one board. */
  savePlacements(boardId: string, diff: PlacementDiff): Promise<void>;
  /** Stores a PNG thumbnail. */
  saveThumbnail(boardId: string, png: Uint8Array): Promise<void>;
}

/** Placements added and removed since the previous run. */
export interface PlacementDiff {
  readonly added: readonly CardPlacementReference[];
  readonly removed: readonly CardPlacementReference[];
}

/** Outcome of processing one board. */
export type BoardReport =
  | {
      readonly boardId: string;
      readonly status: 'processed';
      /** Records dropped as invalid in non-strict mode; the rest of the board was kept. */
      readonly invalidRecords: readonly string[];
      readonly placements: PlacementDiff;
      /** `skipped` when no canvas is available on this server. */
      readonly thumbnail: 'saved' | 'skipped';
      readonly thumbnailError?: string;
    }
  | { readonly boardId: string; readonly status: 'invalid'; readonly errors: readonly string[] }
  | { readonly boardId: string; readonly status: 'missing' }
  | { readonly boardId: string; readonly status: 'failed'; readonly error: string };

export interface BoardWorkerOptions {
  readonly store: WorkerStore;
  /** Plugins with the element definitions of the application (props schemas, `references`). */
  readonly plugins: readonly AnyPluginDefinition[];
  /** Quiet time after the last save before a board is processed. Defaults to 2000 ms. */
  readonly debounceMs?: number;
  /** Rejects the whole board when any record is invalid. Defaults to `false`. */
  readonly strict?: boolean;
  /** Thumbnail width in pixels. Defaults to 320. */
  readonly thumbnailWidth?: number;
  /** Canvas for thumbnails; defaults to `@napi-rs/canvas` when it is installed. */
  readonly canvasFactory?: CanvasFactory;
  /** Called after every processed board, for logs and metrics. */
  readonly onReport?: (report: BoardReport) => void;
}

export interface BoardWorker {
  /** Schedules a board after a save; repeated saves within `debounceMs` run it once. */
  enqueue(boardId: string): void;
  /** Processes a board now, skipping the debounce. */
  process(boardId: string): Promise<BoardReport>;
  /** Processes every pending board now and resolves when all are done. */
  flush(): Promise<BoardReport[]>;
  /** Cancels pending boards; a run already in progress finishes. */
  stop(): void;
}

/** Stable key of a placement, for the diff. */
function placementKey(ref: CardPlacementReference): string {
  return JSON.stringify([ref.resolver, ref.id, ref.elementId, ref.pageId, ref.frameId ?? null]);
}

/** Placements of `next` that are not in `previous`, and the other way around. */
export function diffPlacements(
  previous: readonly CardPlacementReference[],
  next: readonly CardPlacementReference[],
): PlacementDiff {
  const before = new Map(previous.map((ref) => [placementKey(ref), ref]));
  const after = new Map(next.map((ref) => [placementKey(ref), ref]));
  return {
    added: [...after].filter(([key]) => !before.has(key)).map(([, ref]) => ref),
    removed: [...before].filter(([key]) => !after.has(key)).map(([, ref]) => ref),
  };
}

export function createBoardWorker(options: BoardWorkerOptions): BoardWorker {
  const { store, plugins } = options;
  const debounceMs = options.debounceMs ?? 2000;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Runs in progress per board, so a board is never processed twice at the same time. */
  const running = new Map<string, Promise<BoardReport>>();

  async function run(boardId: string): Promise<BoardReport> {
    const state = await store.loadState(boardId);
    if (!state) return { boardId, status: 'missing' };

    const validation = validateServerDocument(state, { plugins, strict: options.strict ?? false });
    if (!validation.valid) return { boardId, status: 'invalid', errors: validation.errors };

    const references = extractReferences(state, { plugins });
    const placements = diffPlacements(await store.loadPlacements(boardId), references);
    if (placements.added.length > 0 || placements.removed.length > 0) {
      await store.savePlacements(boardId, placements);
    }

    let thumbnail: 'saved' | 'skipped' = 'skipped';
    let thumbnailError: string | undefined;
    try {
      const png = await renderThumbnail(state, {
        plugins,
        width: options.thumbnailWidth ?? 320,
        ...(options.canvasFactory ? { canvasFactory: options.canvasFactory } : {}),
      });
      await store.saveThumbnail(boardId, png);
      thumbnail = 'saved';
    } catch (error) {
      // No canvas on this server: the client thumbnail stays (BOARD-1708).
      thumbnailError = error instanceof Error ? error.message : String(error);
    }

    return {
      boardId,
      status: 'processed',
      invalidRecords: Object.keys(validation.invalidRecords),
      placements,
      thumbnail,
      ...(thumbnailError ? { thumbnailError } : {}),
    };
  }

  function process(boardId: string): Promise<BoardReport> {
    const pending = timers.get(boardId);
    if (pending) {
      clearTimeout(pending);
      timers.delete(boardId);
    }
    const previous = running.get(boardId) ?? Promise.resolve(null);
    const next = previous
      .then(() => run(boardId))
      .catch((error): BoardReport => ({
        boardId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }))
      .then((report) => {
        options.onReport?.(report);
        return report;
      })
      .finally(() => {
        if (running.get(boardId) === next) running.delete(boardId);
      });
    running.set(boardId, next);
    return next;
  }

  return {
    enqueue(boardId) {
      const pending = timers.get(boardId);
      if (pending) clearTimeout(pending);
      timers.set(
        boardId,
        setTimeout(() => {
          timers.delete(boardId);
          void process(boardId);
        }, debounceMs),
      );
    },
    process,
    async flush() {
      const ids = [...timers.keys()];
      return Promise.all([...ids.map(process), ...running.values()]).then((reports) => {
        const seen = new Set<string>();
        return reports.filter((r) => !seen.has(r.boardId) && seen.add(r.boardId));
      });
    },
    stop() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
