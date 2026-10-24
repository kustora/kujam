/**
 * File I/O helpers for exporting and importing board documents (BOARD-2403), including
 * Excalidraw files (BOARD-1706).
 */

import { validateDocument, type Board, type BoardDocument } from '@kujam/core';
import { importExcalidraw } from '@kujam/export';
import { h } from './dom.js';

export interface ImportResult {
  readonly success: boolean;
  readonly errors?: string[];
  /** Non-fatal notes, such as Excalidraw elements that were left out. */
  readonly warnings?: string[];
  /** Number of elements added, for Excalidraw imports. */
  readonly imported?: number;
}

/** File extensions and MIME types of the document picker. */
const JSON_FILES = '.json,application/json';
/** Excalidraw files are JSON too; some systems report them as `application/json`. */
const EXCALIDRAW_FILES = '.excalidraw,application/json';

function isAcceptedFile(file: File): boolean {
  return (
    file.name.endsWith('.json') ||
    file.name.endsWith('.excalidraw') ||
    file.type === 'application/json'
  );
}

function isExcalidraw(value: unknown): boolean {
  const type = (value as { type?: unknown } | null)?.type;
  return type === 'excalidraw' || type === 'excalidraw/clipboard';
}

/** Imports Excalidraw data into the board as one undo step, reporting what was left out. */
function importExcalidrawFile(board: Board, parsed: unknown): ImportResult {
  try {
    const result = importExcalidraw(board, parsed);
    const warnings = result.unsupported.map(
      (item) =>
        `Elemen Excalidraw "${item.id}" (${item.type || 'tanpa tipe'}) dilewati: ${item.reason}.`,
    );
    for (const item of result.rejected)
      warnings.push(`Record "${item.id}" ditolak: ${item.errors.join('; ')}`);
    return { success: true, warnings, imported: result.ids.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [`Gagal mengimpor berkas Excalidraw: ${message}`] };
  }
}

/**
 * Imports Excalidraw JSON text into the current page of the board (BOARD-1706), as one undo step.
 * Unlike {@link importDocumentFromJson}, the board content is kept.
 */
export function importExcalidrawFromText(board: Board, text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [`Format file bukan JSON yang valid: ${message}`] };
  }
  if (!isExcalidraw(parsed)) {
    return { success: false, errors: ['Berkas bukan berkas Excalidraw (.excalidraw).'] };
  }
  return importExcalidrawFile(board, parsed);
}

/**
 * Exports the current board document to a downloadable JSON file.
 */
export function exportDocumentToJson(board: Board, filename?: string): void {
  const doc = board.getDocument();
  const jsonString = JSON.stringify(doc, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  anchor.download = filename ?? `papan-kujam-${dateStr}.json`;
  anchor.href = url;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Validates and loads a JSON document into the board. Excalidraw files are imported into the
 * current page instead of replacing the document.
 */
export function importDocumentFromJson(board: Board, jsonString: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [`Format file bukan JSON yang valid: ${message}`] };
  }

  if (isExcalidraw(parsed)) return importExcalidrawFile(board, parsed);

  const validation = validateDocument(parsed);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  // Load document using board.load or board.loadDocument
  const targetBoard = board as unknown as {
    load?(doc: BoardDocument): void;
    loadDocument(doc: BoardDocument): void;
  };
  if (typeof targetBoard.load === 'function') {
    targetBoard.load(parsed as BoardDocument);
  } else {
    targetBoard.loadDocument(parsed as BoardDocument);
  }

  return { success: true };
}

interface ImportCallbacks {
  onSuccess?: (result: ImportResult) => void;
  onError?: (errors: string[]) => void;
}

/** Opens a native file picker and passes the chosen file's text to `load`. */
function pickFile(
  accept: string,
  load: (text: string) => ImportResult,
  callbacks: ImportCallbacks | undefined,
): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.display = 'none';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const result = load(await file.text());
      if (result.success) {
        callbacks?.onSuccess?.(result);
      } else {
        callbacks?.onError?.(result.errors ?? ['Gagal memvalidasi dokumen.']);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks?.onError?.([`Gagal membaca file: ${msg}`]);
    } finally {
      input.remove();
    }
  };

  document.body.appendChild(input);
  input.click();
}

/**
 * Opens a native file picker to select a JSON document and load it into the board.
 */
export function openDocumentFromFilePicker(board: Board, callbacks?: ImportCallbacks): void {
  pickFile(JSON_FILES, (text) => importDocumentFromJson(board, text), callbacks);
}

/**
 * Opens a native file picker to select an Excalidraw file and add it to the current page.
 */
export function openExcalidrawFromFilePicker(board: Board, callbacks?: ImportCallbacks): void {
  pickFile(EXCALIDRAW_FILES, (text) => importExcalidrawFromText(board, text), callbacks);
}

/**
 * Attaches drag-and-drop listener to the stage element to import dropped JSON documents.
 */
export function attachDragAndDropImport(
  stage: HTMLElement,
  getBoard: () => Board,
  callbacks?: ImportCallbacks,
): () => void {
  let dragCounter = 0;

  function onDragEnter(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragCounter++;
    stage.classList.add('drag-over');
  }

  function onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      stage.classList.remove('drag-over');
    }
  }

  async function onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    dragCounter = 0;
    stage.classList.remove('drag-over');

    const file = e.dataTransfer?.files[0];
    if (!file) return;

    if (!isAcceptedFile(file)) {
      callbacks?.onError?.([
        'File yang dijatuhkan harus berupa dokumen JSON (.json) atau Excalidraw (.excalidraw).',
      ]);
      return;
    }

    try {
      const text = await file.text();
      const result = importDocumentFromJson(getBoard(), text);
      if (result.success) {
        callbacks?.onSuccess?.(result);
      } else {
        callbacks?.onError?.(result.errors ?? ['Dokumen JSON tidak lolos validasi.']);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks?.onError?.([`Gagal membaca berkas: ${msg}`]);
    }
  }

  stage.addEventListener('dragenter', onDragEnter);
  stage.addEventListener('dragover', onDragOver);
  stage.addEventListener('dragleave', onDragLeave);
  stage.addEventListener('drop', onDrop);

  return () => {
    stage.removeEventListener('dragenter', onDragEnter);
    stage.removeEventListener('dragover', onDragOver);
    stage.removeEventListener('dragleave', onDragLeave);
    stage.removeEventListener('drop', onDrop);
    stage.classList.remove('drag-over');
  };
}

const TIP = 'Tip: Anda juga dapat menjatuhkan berkas .json atau .excalidraw langsung ke kanvas.';

/**
 * Creates File I/O control buttons with localized UI labels.
 */
export function createFileIoControls(
  getBoard: () => Board,
  callbacks?: ImportCallbacks,
): HTMLElement {
  const statusNotice = h(
    'div',
    {
      class: 'muted',
      style: 'font-size: 11px; margin-top: 4px; line-height: 1.4;',
    },
    TIP,
  );

  function notify(text: string, color: string): void {
    statusNotice.textContent = text;
    statusNotice.style.color = color;
  }

  function resetLater(): void {
    setTimeout(() => notify(TIP, ''), 3000);
  }

  const onError = (errors: string[]): void => {
    notify(`❌ ${errors[0]}`, 'var(--error)');
    callbacks?.onError?.(errors);
  };

  const importBtn = h(
    'button',
    {
      type: 'button',
      onclick: () => {
        openDocumentFromFilePicker(getBoard(), {
          onSuccess: (result) => {
            notify('✅ Dokumen berhasil diimpor!', 'var(--ok)');
            callbacks?.onSuccess?.(result);
            resetLater();
          },
          onError,
        });
      },
    },
    '📥 Impor Dokumen (.json)',
  );

  const excalidrawBtn = h(
    'button',
    {
      type: 'button',
      dataset: { testid: 'import-excalidraw' },
      title: 'Menambahkan isi berkas Excalidraw ke halaman aktif (satu langkah undo).',
      onclick: () => {
        openExcalidrawFromFilePicker(getBoard(), {
          onSuccess: (result) => {
            const skipped = result.warnings?.length ?? 0;
            notify(
              `✅ ${result.imported ?? 0} elemen Excalidraw diimpor` +
                (skipped > 0 ? `; ${skipped} dilewati (lihat konsol).` : '.'),
              'var(--ok)',
            );
            if (skipped > 0) console.warn('[kujam] Impor Excalidraw:', result.warnings);
            callbacks?.onSuccess?.(result);
            resetLater();
          },
          onError,
        });
      },
    },
    '🧩 Impor Excalidraw (.excalidraw)',
  );

  const exportBtn = h(
    'button',
    {
      type: 'button',
      onclick: () => {
        exportDocumentToJson(getBoard());
        notify('✅ Dokumen berhasil diekspor!', 'var(--ok)');
        resetLater();
      },
    },
    '📤 Ekspor Dokumen (.json)',
  );

  return h(
    'div',
    { class: 'column' },
    h('div', { class: 'row wrap' }, importBtn, excalidrawBtn, exportBtn),
    statusNotice,
  );
}
