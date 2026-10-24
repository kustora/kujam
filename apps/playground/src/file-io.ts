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
}

/** File extensions and MIME types the picker and drop target accept. */
const ACCEPTED_FILES = '.json,.excalidraw,application/json';

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
    return { success: true, warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [`Gagal mengimpor berkas Excalidraw: ${message}`] };
  }
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

/**
 * Opens a native file picker to select a JSON document and load it into the board.
 */
export function openDocumentFromFilePicker(
  board: Board,
  callbacks?: {
    onSuccess?: (warnings?: readonly string[]) => void;
    onError?: (errors: string[]) => void;
  },
): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPTED_FILES;
  input.style.display = 'none';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = importDocumentFromJson(board, text);
      if (result.success) {
        callbacks?.onSuccess?.(result.warnings);
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
 * Attaches drag-and-drop listener to the stage element to import dropped JSON documents.
 */
export function attachDragAndDropImport(
  stage: HTMLElement,
  getBoard: () => Board,
  callbacks?: {
    onSuccess?: (warnings?: readonly string[]) => void;
    onError?: (errors: string[]) => void;
  },
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
        callbacks?.onSuccess?.(result.warnings);
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

/**
 * Creates File I/O control buttons with localized UI labels.
 */
const TIP = 'Tip: Anda juga dapat menjatuhkan berkas .json atau .excalidraw langsung ke kanvas.';

export function createFileIoControls(
  getBoard: () => Board,
  callbacks?: {
    onSuccess?: (warnings?: readonly string[]) => void;
    onError?: (errors: string[]) => void;
  },
): HTMLElement {
  const statusNotice = h(
    'div',
    {
      class: 'muted',
      style: 'font-size: 11px; margin-top: 4px; line-height: 1.4;',
    },
    TIP,
  );

  const importBtn = h(
    'button',
    {
      type: 'button',
      onclick: () => {
        openDocumentFromFilePicker(getBoard(), {
          onSuccess: (warnings) => {
            statusNotice.textContent = warnings?.length
              ? `✅ Dokumen diimpor; ${warnings.length} elemen dilewati (lihat konsol).`
              : '✅ Dokumen berhasil diimpor!';
            statusNotice.style.color = 'var(--ok)';
            if (warnings?.length) console.warn('[kujam] Impor:', warnings);
            callbacks?.onSuccess?.(warnings);
            setTimeout(() => {
              statusNotice.textContent = TIP;
              statusNotice.style.color = '';
            }, 3000);
          },
          onError: (errors) => {
            statusNotice.textContent = `❌ ${errors[0]}`;
            statusNotice.style.color = 'var(--error)';
            callbacks?.onError?.(errors);
          },
        });
      },
    },
    '📥 Impor Dokumen (.json, .excalidraw)',
  );

  const exportBtn = h(
    'button',
    {
      type: 'button',
      onclick: () => {
        exportDocumentToJson(getBoard());
        statusNotice.textContent = '✅ Dokumen berhasil diekspor!';
        statusNotice.style.color = 'var(--ok)';
        setTimeout(() => {
          statusNotice.textContent = TIP;
          statusNotice.style.color = '';
        }, 3000);
      },
    },
    '📤 Ekspor Dokumen (.json)',
  );

  return h(
    'div',
    { class: 'column' },
    h('div', { class: 'row wrap' }, importBtn, exportBtn),
    statusNotice,
  );
}
