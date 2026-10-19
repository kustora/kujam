import {
  type ActionEvent,
  type Board,
  type BoardErrorEvent,
  type CameraEvent,
  type ChangeEvent,
  type ChangeOrigin,
  type HistoryStep,
  type RecordsDiff,
  type SelectionEvent,
  type ToolEvent,
} from '@kujam/core';
import { h, json, section } from './dom.js';

interface LogEntry {
  readonly id: number;
  readonly timestamp: Date;
  readonly type: 'change' | 'selection' | 'camera' | 'tool' | 'action' | 'error';
  readonly origin: ChangeOrigin | '-';
  readonly label: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly isError?: boolean;
  expanded?: boolean;
}

const MAX_LOG_ENTRIES = 300;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function formatTimestamp(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function summarizeDiff(diff: RecordsDiff): string {
  const a = Object.keys(diff.added).length;
  const u = Object.keys(diff.updated).length;
  const r = Object.keys(diff.removed).length;
  const parts: string[] = [];
  if (a > 0) parts.push(`+${a}`);
  if (u > 0) parts.push(`~${u}`);
  if (r > 0) parts.push(`-${r}`);
  return parts.length > 0 ? parts.join(' ') : 'tanpa perubahan';
}

/**
 * Event log stream and Undo/Redo history inspector (BOARD-2405).
 */
export function createEventLog(
  board: Board,
  container: HTMLElement,
): { dispose(): void } {
  let isPaused = false;
  let typeFilter = 'all';
  let originFilter = 'all';
  let nextEntryId = 1;

  const entries: LogEntry[] = [];

  // ---------- DOM Setup ----------

  // 1. Controls
  const pauseBtn = h('button', { type: 'button' }, '⏸️ Jeda');
  pauseBtn.onclick = () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? '▶️ Lanjutkan' : '⏸️ Jeda';
    pauseBtn.style.borderColor = isPaused ? 'var(--warn)' : 'var(--border)';
    renderStream();
  };

  const clearBtn = h(
    'button',
    {
      type: 'button',
      class: 'ghost',
      onclick: () => {
        entries.length = 0;
        renderStream();
      },
    },
    'Bersihkan',
  );

  const typeSelect = h(
    'select',
    {
      onchange: () => {
        typeFilter = typeSelect.value;
        renderStream();
      },
    },
    h('option', { value: 'all' }, 'Semua event'),
    h('option', { value: 'change' }, 'change'),
    h('option', { value: 'selection' }, 'selection'),
    h('option', { value: 'camera' }, 'camera'),
    h('option', { value: 'tool' }, 'tool'),
    h('option', { value: 'action' }, 'action'),
    h('option', { value: 'error' }, 'error'),
  );

  const originSelect = h(
    'select',
    {
      onchange: () => {
        originFilter = originSelect.value;
        renderStream();
      },
    },
    h('option', { value: 'all' }, 'Semua asal'),
    h('option', { value: 'local' }, 'local'),
    h('option', { value: 'remote' }, 'remote'),
    h('option', { value: 'undo' }, 'undo'),
    h('option', { value: 'redo' }, 'redo'),
    h('option', { value: 'load' }, 'load'),
    h('option', { value: 'migration' }, 'migration'),
  );

  const countBadge = h('span', { class: 'stat-label', style: 'font-size: 11px; margin-left: auto;' }, '0 event');

  const controlsRow = h(
    'div',
    { class: 'event-controls' },
    pauseBtn,
    clearBtn,
    typeSelect,
    originSelect,
    countBadge,
  );

  // 2. Event stream list
  const streamContainer = h('div', { class: 'event-stream' });

  // 3. Undo/Redo stack view
  const undoCountBadge = h('span', { class: 'stat-val' }, '0');
  const redoCountBadge = h('span', { class: 'stat-val' }, '0');

  const quickUndoBtn = h('button', { type: 'button', onclick: () => board.undo() }, '↩️ Undo');
  const quickRedoBtn = h('button', { type: 'button', onclick: () => board.redo() }, '↪️ Redo');
  const clearHistoryBtn = h(
    'button',
    {
      type: 'button',
      class: 'ghost',
      onclick: () => {
        board.history.clear();
        updateHistoryView();
      },
    },
    'Kosongkan Riwayat',
  );

  const historyHeader = h(
    'div',
    { class: 'row wrap', style: 'justify-content: space-between; margin-bottom: 6px;' },
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'stat-label' }, 'Undo:'),
      undoCountBadge,
      h('span', { class: 'stat-label', style: 'margin-left: 8px;' }, 'Redo:'),
      redoCountBadge,
    ),
    h('div', { class: 'row' }, quickUndoBtn, quickRedoBtn, clearHistoryBtn),
  );

  const undoListEl = h('div', { class: 'history-list' });
  const redoListEl = h('div', { class: 'history-list' });

  const historyCard = h(
    'div',
    { class: 'history-card' },
    historyHeader,
    h('div', { class: 'stat-label', style: 'font-size: 11px; font-weight: 600; margin-top: 4px;' }, 'Tumpukan Undo (klik langkah untuk mundur):'),
    undoListEl,
    h('div', { class: 'stat-label', style: 'font-size: 11px; font-weight: 600; margin-top: 8px;' }, 'Tumpukan Redo (klik langkah untuk maju):'),
    redoListEl,
  );

  container.append(
    section('Log Event Real-Time', controlsRow, streamContainer),
    section('Penampil Riwayat Undo & Redo', historyCard),
  );

  // ---------- Helpers & Event Logging ----------

  function addEntry(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
    if (isPaused) return;

    const fullEntry: LogEntry = {
      ...entry,
      id: nextEntryId++,
      timestamp: new Date(),
    };

    entries.unshift(fullEntry);
    if (entries.length > MAX_LOG_ENTRIES) {
      entries.pop();
    }

    renderStream();
  }

  function renderStream(): void {
    countBadge.textContent = `${entries.length} event${isPaused ? ' (dijeda)' : ''}`;

    const filtered = entries.filter((e) => {
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (originFilter !== 'all' && e.origin !== originFilter) return false;
      return true;
    });

    streamContainer.replaceChildren();

    if (filtered.length === 0) {
      streamContainer.append(h('div', { class: 'empty-state' }, 'Belum ada event tercatat.'));
      return;
    }

    for (const entry of filtered) {
      const row = h('div', {
        class: `event-entry${entry.isError ? ' error' : ''}`,
      });

      const timeSpan = h('span', { class: 'event-time' }, formatTimestamp(entry.timestamp));
      const badgeSpan = h('span', { class: `event-badge badge-${entry.type}` }, entry.type);
      const originSpan = h('span', { class: 'event-origin' }, entry.origin);
      const labelSpan = h('span', { class: 'event-label-text' }, entry.label);
      const summarySpan = h('span', { class: 'event-diff-stats' }, entry.summary);

      const summaryRow = h(
        'div',
        {
          class: 'event-summary-row',
          onclick: () => {
            entry.expanded = !entry.expanded;
            renderStream();
          },
        },
        timeSpan,
        badgeSpan,
        originSpan,
        labelSpan,
        summarySpan,
      );

      row.append(summaryRow);

      if (entry.expanded) {
        const detailPre = h('pre', { class: 'event-detail-pre' }, json(entry.payload));
        row.append(detailPre);
      }

      streamContainer.append(row);
    }
  }

  function updateHistoryView(): void {
    quickUndoBtn.disabled = !board.history.canUndo;
    quickRedoBtn.disabled = !board.history.canRedo;

    const undoStack: readonly HistoryStep[] = board.history.undoStack ?? [];
    const redoStack: readonly HistoryStep[] = board.history.redoStack ?? [];

    undoCountBadge.textContent = String(undoStack.length);
    redoCountBadge.textContent = String(redoStack.length);

    undoListEl.replaceChildren();
    if (undoStack.length === 0) {
      undoListEl.append(h('div', { class: 'empty-state', style: 'padding: 6px;' }, '(kosong)'));
    } else {
      // Show newest steps at top for easier access
      for (let i = undoStack.length - 1; i >= 0; i--) {
        const step = undoStack[i]!;
        const stepsToUndo = undoStack.length - i;
        const diffInfo = step.diff ? summarizeDiff(step.diff) : '';

        const item = h(
          'div',
          {
            class: 'history-step-item',
            title: `Klik untuk undo ${stepsToUndo} langkah ke titik ini`,
            onclick: () => {
              for (let k = 0; k < stepsToUndo; k++) {
                board.undo();
              }
              updateHistoryView();
            },
          },
          h('span', { class: 'history-step-name' }, `[${i + 1}] ${step.label ?? 'transaksi'}`),
          h('span', { class: 'history-step-meta' }, diffInfo),
        );
        undoListEl.append(item);
      }
    }

    redoListEl.replaceChildren();
    if (redoStack.length === 0) {
      redoListEl.append(h('div', { class: 'empty-state', style: 'padding: 6px;' }, '(kosong)'));
    } else {
      // Show next step to redo at top
      for (let j = redoStack.length - 1; j >= 0; j--) {
        const step = redoStack[j]!;
        const stepsToRedo = redoStack.length - j;
        const diffInfo = step.diff ? summarizeDiff(step.diff) : '';

        const item = h(
          'div',
          {
            class: 'history-step-item',
            title: `Klik untuk redo ${stepsToRedo} langkah ke titik ini`,
            onclick: () => {
              for (let k = 0; k < stepsToRedo; k++) {
                board.redo();
              }
              updateHistoryView();
            },
          },
          h('span', { class: 'history-step-name' }, `[${j + 1}] ${step.label ?? 'transaksi'}`),
          h('span', { class: 'history-step-meta' }, diffInfo),
        );
        redoListEl.append(item);
      }
    }
  }

  // ---------- Board Event Subscriptions ----------

  const offChange = board.on('change', (e: ChangeEvent) => {
    addEntry({
      type: 'change',
      origin: e.origin,
      label: e.label ?? '-',
      summary: summarizeDiff(e),
      payload: e,
    });
    updateHistoryView();
  });

  const offSelection = board.on('selection', (e: SelectionEvent) => {
    addEntry({
      type: 'selection',
      origin: 'local',
      label: e.ids.length > 0 ? e.ids.join(', ') : '(kosong)',
      summary: `${e.ids.length} dipilih`,
      payload: e,
    });
  });

  const offCamera = board.on('camera', (e: CameraEvent) => {
    addEntry({
      type: 'camera',
      origin: '-',
      label: `(${Math.round(e.camera.x)}, ${Math.round(e.camera.y)})`,
      summary: `${Math.round(e.camera.zoom * 100)}%`,
      payload: e,
    });
  });

  const offTool = board.on('tool', (e: ToolEvent) => {
    addEntry({
      type: 'tool',
      origin: '-',
      label: e.id ?? '(none)',
      summary: e.previous ? `dari ${e.previous}` : 'awal',
      payload: e,
    });
  });

  const offAction = board.on('action', (e: ActionEvent) => {
    addEntry({
      type: 'action',
      origin: '-',
      label: e.name,
      summary: 'aksi plugin',
      payload: e,
    });
  });

  const offError = board.on('error', (e: BoardErrorEvent) => {
    addEntry({
      type: 'error',
      origin: '-',
      label: e.code,
      summary: e.message,
      payload: e,
      isError: true,
    });
  });

  const offHistory = board.on('history', () => {
    updateHistoryView();
  });

  // Initial render
  updateHistoryView();
  renderStream();

  return {
    dispose() {
      offChange();
      offSelection();
      offCamera();
      offTool();
      offAction();
      offError();
      offHistory();
    },
  };
}
