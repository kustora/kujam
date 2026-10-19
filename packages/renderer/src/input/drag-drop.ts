/**
 * Drag-and-drop file import handling for the whiteboard (BOARD-908).
 *
 * Listens to `dragover`, `dragenter`, `dragleave`, and `drop` events on the view root.
 * Image files are inserted side-by-side with a 24px gap at the drop coordinate.
 * Non-image files are forwarded to `acceptDrop` or rejected via `onDropRejected`.
 * Upload states are tracked when an asset upload adapter is configured.
 */

import {
  DEFAULT_ARRANGE_GAP,
  indexAbove,
  type AssetRecord,
  type Board,
  type ElementRecord,
  type Point,
} from '@kujam/core';

/** Default image placeholder width in board units. */
const DEFAULT_IMAGE_WIDTH = 320;

/** Default image placeholder height in board units. */
const DEFAULT_IMAGE_HEIGHT = 240;

/** Local cache for object URLs of images inserted without an upload adapter. */
const localAssetCache = new Map<string, string>();

/**
 * Returns the local object URL for a cached asset, if available.
 *
 * @param assetId - Unique asset record identifier.
 * @returns Cached object URL, or `undefined`.
 * @beta
 */
export function getLocalAssetUrl(assetId: string): string | undefined {
  return localAssetCache.get(assetId);
}

/**
 * Checks whether a given file is an image based on its MIME type or file extension.
 *
 * @param file - File to test.
 * @returns `true` if the file has an image MIME type or supported image extension.
 * @beta
 */
export function isImageFile(file: File): boolean {
  return (
    (typeof file.type === 'string' && file.type.startsWith('image/')) ||
    /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(file.name)
  );
}

/**
 * Options for {@link attachDragDrop}.
 *
 * @public
 */
export interface DragDropOptions {
  /**
   * Called to handle dropped non-image files.
   *
   * @param files - Dropped files that are not images.
   * @param point - Point on the board where files were dropped.
   * @param board - Board instance receiving the drop.
   * @returns `true` (or a promise resolving to `true`) if handled, `false` to reject.
   */
  readonly acceptDrop?: (
    files: readonly File[],
    point: Point,
    board: Board,
  ) => boolean | Promise<boolean>;

  /**
   * Called when dropped files are rejected.
   *
   * @param files - Files that were rejected.
   * @param reason - Diagnostic reason string (e.g. `'unsupported-file-type'`).
   */
  readonly onDropRejected?: (files: readonly File[], reason: string) => void;
}

/**
 * Measures dimensions of an image file if available on the file object,
 * otherwise returns default dimensions.
 */
function measureImageDimensions(file: File): { w: number; h: number } {
  const fileWithDims = file as unknown as { width?: number; height?: number };
  if (
    typeof fileWithDims.width === 'number' &&
    Number.isFinite(fileWithDims.width) &&
    fileWithDims.width > 0 &&
    typeof fileWithDims.height === 'number' &&
    Number.isFinite(fileWithDims.height) &&
    fileWithDims.height > 0
  ) {
    return { w: fileWithDims.width, h: fileWithDims.height };
  }

  return { w: DEFAULT_IMAGE_WIDTH, h: DEFAULT_IMAGE_HEIGHT };
}

/**
 * Inserts one or more image files onto the board at the specified board coordinate (BOARD-908).
 *
 * Multiple images are arranged side-by-side with a 24px gap. Creates asset records
 * and image elements in a single history transaction and selects the inserted elements.
 * If `board.assets?.upload` is configured, asynchronously uploads the files and
 * tracks upload status and progress.
 *
 * @param board - Target board instance.
 * @param files - Image files to insert.
 * @param at - Target position in board coordinates.
 * @returns Array of created image element IDs.
 * @beta
 */
export async function insertImageFiles(
  board: Board,
  files: readonly File[],
  at: Point,
): Promise<readonly string[]> {
  if (board.readOnly || files.length === 0) {
    return [];
  }

  const elementRecords: ElementRecord[] = [];
  const assetRecords: AssetRecord[] = [];
  const createdIds: string[] = [];
  const assetIds: string[] = [];

  const existing = board.query({ pageId: board.pages.current });
  let lastIndex = existing.length > 0 ? existing[existing.length - 1]!.index : null;

  let currentX = at.x;
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const dims = measureImageDimensions(file);
    const w = dims.w;
    const h = dims.h;
    const x = currentX;
    const y = at.y;
    currentX += w + DEFAULT_ARRANGE_GAP;

    const assetId = board.createId();
    const elementId = board.createId();
    assetIds.push(assetId);
    createdIds.push(elementId);

    const assetRecord: AssetRecord = {
      id: assetId,
      kind: 'asset',
      mimeType: file.type || 'image/png',
      w,
      h,
      meta: {
        filename: file.name,
        size: file.size,
      },
    };
    assetRecords.push(assetRecord);

    const nextIndex = indexAbove(lastIndex);
    lastIndex = nextIndex;

    const elementRecord: ElementRecord = {
      id: elementId,
      kind: 'element',
      type: 'image',
      pageId: board.pages.current,
      parentId: null,
      index: nextIndex,
      x,
      y,
      w,
      h,
      rotation: 0,
      locked: false,
      opacity: 1,
      props: {
        assetId,
        alt: file.name.replace(/\.[^/.]+$/, ''),
        crop: null,
        uploadStatus: board.assets?.upload ? 'uploading' : 'ready',
        uploadProgress: 0,
      },
      meta: {},
    };
    elementRecords.push(elementRecord);
  }

  board.transact(
    (tx) => {
      for (const asset of assetRecords) {
        tx.put(asset);
      }
      for (const element of elementRecords) {
        tx.put(element);
      }
    },
    { label: 'image.drop' },
  );

  board.select(createdIds);

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const elementId = createdIds[i]!;
    const assetId = assetIds[i]!;

    if (board.assets?.upload) {
      const upload = board.assets.upload;
      Promise.resolve(upload.call(board.assets, file))
        .then((uploadedId) => {
          if (board.disposed || !board.getElement(elementId)) return;
          const patchProps: Record<string, unknown> = {
            assetId: uploadedId || assetId,
            uploadStatus: 'ready',
            uploadProgress: 100,
          };
          const updated = board.update(elementId, {
            props: patchProps,
          });
          if (!updated) {
            const current = board.getElement(elementId);
            if (current) {
              board.transact(
                (tx) => {
                  tx.put({
                    ...current,
                    props: { ...current.props, ...patchProps },
                  });
                },
                { label: 'image.upload' },
              );
            }
          }
        })
        .catch((err: unknown) => {
          if (board.disposed || !board.getElement(elementId)) return;
          const patchProps: Record<string, unknown> = {
            uploadStatus: 'error',
            uploadError: err instanceof Error ? err.message : String(err),
          };
          const updated = board.update(elementId, {
            props: patchProps,
          });
          if (!updated) {
            const current = board.getElement(elementId);
            if (current) {
              board.transact(
                (tx) => {
                  tx.put({
                    ...current,
                    props: { ...current.props, ...patchProps },
                  });
                },
                { label: 'image.upload' },
              );
            }
          }
        });
    } else {
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        try {
          const objectUrl = URL.createObjectURL(file);
          localAssetCache.set(assetId, objectUrl);
        } catch {
          // Ignore URL generation failure
        }
      }
    }
  }

  return createdIds;
}

/**
 * Attaches drag-and-drop file handling to the view root element (BOARD-908).
 *
 * @param board - Whiteboard instance to insert dropped files into.
 * @param root - DOM root element of the renderer view.
 * @param options - Drag and drop options.
 * @returns Detach callback to remove event listeners.
 * @beta
 */
export function attachDragDrop(
  board: Board,
  root: HTMLElement,
  options: DragDropOptions = {},
): () => void {
  function hasFiles(e: DragEvent): boolean {
    if (!e.dataTransfer?.types) return false;
    return (
      Array.from(e.dataTransfer.types).includes('Files') ||
      (typeof e.dataTransfer.types.includes === 'function' &&
        e.dataTransfer.types.includes('Files'))
    );
  }

  function onDragOver(e: DragEvent): void {
    if (hasFiles(e)) {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    }
  }

  function onDragEnter(e: DragEvent): void {
    if (hasFiles(e)) {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    }
  }

  function onDragLeave(_e: DragEvent): void {}

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();

    if (board.readOnly) return;

    const rect = root.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const dropPoint = board.camera.screenToBoard(screen);

    const fileList = e.dataTransfer?.files;
    if (!fileList || fileList.length === 0) return;

    const allFiles = Array.from(fileList);
    const imageFiles = allFiles.filter(isImageFile);
    const nonImageFiles = allFiles.filter((f) => !isImageFile(f));

    if (nonImageFiles.length > 0) {
      if (options.acceptDrop) {
        const result = options.acceptDrop(nonImageFiles, dropPoint, board);
        if (result instanceof Promise) {
          result
            .then((accepted) => {
              if (accepted === false) {
                options.onDropRejected?.(nonImageFiles, 'unsupported-file-type');
              }
            })
            .catch(() => {
              options.onDropRejected?.(nonImageFiles, 'unsupported-file-type');
            });
        } else if (result === false) {
          options.onDropRejected?.(nonImageFiles, 'unsupported-file-type');
        }
      } else {
        options.onDropRejected?.(nonImageFiles, 'unsupported-file-type');
      }
    }

    if (imageFiles.length > 0) {
      void insertImageFiles(board, imageFiles, dropPoint);
    }
  }

  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragenter', onDragEnter);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('drop', onDrop);

  return () => {
    root.removeEventListener('dragover', onDragOver);
    root.removeEventListener('dragenter', onDragEnter);
    root.removeEventListener('dragleave', onDragLeave);
    root.removeEventListener('drop', onDrop);
  };
}
