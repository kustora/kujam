/**
 * File I/O helpers for exporting and importing board documents (BOARD-2403).
 */

import { validateDocument, type Board, type BoardDocument } from '@kujam/core';
import { h } from './dom.js';

export interface ImportResult {
  readonly success: boolean;
  readonly errors?: string[];
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
 * Validates and loads a JSON document into the board.
 */
export function importDocumentFromJson(board: Board, jsonString: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [`Format file bukan JSON yang valid: ${message}`] };
  }

  const validation = validateDocument(parsed);
  if (!validation.valid) {
    return { success: false, errors: validation.errors };
  }

  // Load document using board.load or board.loadDocument
  const targetBoard = board as unknown as { load?(doc: BoardDocument): void; loadDocument(doc: BoardDocument): void };
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
    onSuccess?: () => void;
    onError?: (errors: string[]) => void;
  },
): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = importDocumentFromJson(board, text);
      if (result.success) {
        callbacks?.onSuccess?.();
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
    onSuccess?: () => void;
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

    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      callbacks?.onError?.(['File yang dijatuhkan harus berupa file dokumen JSON (.json).']);
      return;
    }

    try {
      const text = await file.text();
      const result = importDocumentFromJson(getBoard(), text);
      if (result.success) {
        callbacks?.onSuccess?.();
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
export function createFileIoControls(
  getBoard: () => Board,
  callbacks?: {
    onSuccess?: () => void;
    onError?: (errors: string[]) => void;
  },
): HTMLElement {
  const statusNotice = h('div', {
    class: 'muted',
    style: 'font-size: 11px; margin-top: 4px; line-height: 1.4;',
  }, 'Tip: Anda juga dapat menjatuhkan berkas .json langsung ke kanvas.');

  const importBtn = h(
    'button',
    {
      type: 'button',
      onclick: () => {
        openDocumentFromFilePicker(getBoard(), {
          onSuccess: () => {
            statusNotice.textContent = '✅ Dokumen berhasil diimpor!';
            statusNotice.style.color = 'var(--ok)';
            callbacks?.onSuccess?.();
            setTimeout(() => {
              statusNotice.textContent = 'Tip: Anda juga dapat menjatuhkan berkas .json langsung ke kanvas.';
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
    '📥 Impor Dokumen (.json)',
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
          statusNotice.textContent = 'Tip: Anda juga dapat menjatuhkan berkas .json langsung ke kanvas.';
          statusNotice.style.color = '';
        }, 3000);
      },
    },
    '📤 Ekspor Dokumen (.json)',
  );

  return h('div', { class: 'column' }, h('div', { class: 'row wrap' }, importBtn, exportBtn), statusNotice);
}
