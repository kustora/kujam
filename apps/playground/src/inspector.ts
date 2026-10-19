import {
  DEFAULT_BOARD_LIMITS,
  type Board,
  type BoardRecord,
  type ElementRecord,
} from '@kujam/core';
import { h, section } from './dom.js';

/**
 * Formats byte size into human-readable text.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Extracts preview text from record props for search and summary.
 */
function getRecordSnippet(rec: BoardRecord): string {
  if (rec.kind === 'page') return rec.name;
  if (rec.kind === 'binding') return `${rec.fromId} ➔ ${rec.toId}`;
  if (rec.kind === 'asset') return `${rec.mimeType} (${rec.w}×${rec.h})`;
  if (rec.kind === 'element') {
    const props = rec.props as Record<string, unknown> | undefined;
    if (!props) return '';
    if (Array.isArray(props.text)) {
      return props.text.map((op: { insert?: unknown }) => String(op.insert ?? '')).join('').trim();
    }
    if (typeof props.text === 'string') return props.text.trim();
    if (Array.isArray(props.label)) {
      return props.label.map((op: { insert?: unknown }) => String(op.insert ?? '')).join('').trim();
    }
    if (typeof props.label === 'string') return props.label.trim();
    if (rec.type === 'draw' && Array.isArray(props.points)) {
      return `${props.points.length} titik`;
    }
    if (rec.type === 'geo' && typeof props.geo === 'string') {
      return `bentuk: ${props.geo}`;
    }
    return `pos: (${Math.round(rec.x)}, ${Math.round(rec.y)})`;
  }
  return '';
}

/**
 * Inspector component for documents, runtime state, and record editing (BOARD-2404).
 */
export function createInspector(
  board: Board,
  container: HTMLElement,
): { update(): void; dispose(): void } {
  // ---------- State ----------
  let selectedRecordId: string | null = null;
  let typeFilter = 'all';
  let searchQuery = '';

  // ---------- DOM Structure ----------
  // 1. Document stats bar
  const schemaVerEl = h('span', { class: 'stat-val' }, '-');
  const elemCountEl = h('span', { class: 'stat-val' }, '-');
  const docSizeEl = h('span', { class: 'stat-val' }, '-');
  const limitBadgeEl = h('span', { class: 'stat-badge', style: 'display: none;' });

  const statsBar = h(
    'div',
    { class: 'stat-bar' },
    h('div', { class: 'stat-item' }, h('span', { class: 'stat-label' }, 'Skema:'), schemaVerEl),
    h('div', { class: 'stat-item' }, h('span', { class: 'stat-label' }, 'Elemen:'), elemCountEl),
    h('div', { class: 'stat-item' }, h('span', { class: 'stat-label' }, 'Ukuran:'), docSizeEl),
    limitBadgeEl,
  );

  // 2. Runtime state bar
  const activeToolEl = h('span', { class: 'stat-val' }, '-');
  const cameraStateEl = h('span', { class: 'stat-val' }, '-');
  const selectionIdsEl = h('span', { class: 'stat-val' }, '-');
  const selectionBoundsEl = h('span', { class: 'stat-val' }, '-');

  const runtimeBar = h(
    'div',
    { class: 'stat-bar' },
    h('div', { class: 'stat-item' }, h('span', { class: 'stat-label' }, 'Tool:'), activeToolEl),
    h('div', { class: 'stat-item' }, h('span', { class: 'stat-label' }, 'Kamera:'), cameraStateEl),
    h('div', { class: 'stat-item' }, h('span', { class: 'stat-label' }, 'Seleksi:'), selectionIdsEl),
    h('div', { class: 'stat-item' }, h('span', { class: 'stat-label' }, 'Bounds:'), selectionBoundsEl),
  );

  // 3. Record list with filter & search
  const searchInput = h('input', {
    type: 'search',
    class: 'inspector-search-input',
    placeholder: 'Cari id, tipe, teks props...',
    oninput: () => {
      searchQuery = searchInput.value.trim().toLowerCase();
      renderRecordList();
    },
  });

  const typeSelect = h(
    'select',
    {
      class: 'inspector-type-select',
      onchange: () => {
        typeFilter = typeSelect.value;
        renderRecordList();
      },
    },
    h('option', { value: 'all' }, 'Semua tipe'),
    h('option', { value: 'sticky' }, 'sticky'),
    h('option', { value: 'draw' }, 'draw'),
    h('option', { value: 'text' }, 'text'),
    h('option', { value: 'geo' }, 'geo'),
    h('option', { value: 'binding' }, 'binding'),
    h('option', { value: 'page' }, 'page'),
  );

  const filterRow = h('div', { class: 'inspector-filter-row' }, searchInput, typeSelect);
  const recordListContainer = h('div', { class: 'record-list' });

  // 4. Record JSON editor
  const editorHeaderId = h('strong', { class: 'record-id' }, '(tidak ada)');
  const editorHeaderType = h('span', { class: 'record-badge' }, '-');
  const editorHeader = h(
    'div',
    { class: 'editor-header' },
    h('div', { class: 'row' }, h('span', {}, 'Edit Record:'), editorHeaderId, editorHeaderType),
  );

  const textarea = h('textarea', {
    class: 'code-input editor-textarea',
    spellcheck: 'false',
    placeholder: 'Pilih record dari daftar di atas untuk mengedit JSON...',
  });

  const statusEl = h('div', { class: 'status', style: 'display: none;' });

  function setStatus(type: 'ok' | 'error' | 'warn' | null, message: string = ''): void {
    if (!type) {
      statusEl.style.display = 'none';
      statusEl.textContent = '';
      statusEl.className = 'status';
      return;
    }
    statusEl.style.display = 'block';
    statusEl.className = `status ${type}`;
    statusEl.textContent = message;
  }

  const applyBtn = h(
    'button',
    {
      type: 'button',
      onclick: () => applyEditorChanges(),
    },
    'Terapkan',
  );

  const resetBtn = h(
    'button',
    {
      type: 'button',
      class: 'ghost',
      onclick: () => resetEditorContent(),
    },
    'Reset',
  );

  const editorActions = h('div', { class: 'row wrap' }, applyBtn, resetBtn);
  const editorContainer = h('div', { class: 'editor-container' }, editorHeader, textarea, statusEl, editorActions);

  // Append all sections to container
  container.append(
    section('Status Dokumen', statsBar),
    section('State Runtime', runtimeBar),
    section('Daftar Record Halaman Aktif', filterRow, recordListContainer),
    section('Editor JSON Record', editorContainer),
  );

  // ---------- Methods & Logic ----------

  function updateStats(): void {
    const doc = board.getDocument();
    schemaVerEl.textContent = `v${doc.schemaVersion}`;

    const records = Object.values(doc.records);
    const elements = records.filter((r) => r.kind === 'element');
    const limits = board.limits ?? DEFAULT_BOARD_LIMITS;

    elemCountEl.textContent = `${elements.length} / ${limits.maxElements}`;

    let jsonString = '';
    try {
      jsonString = JSON.stringify(doc);
    } catch {
      jsonString = '';
    }
    const byteLength = new TextEncoder().encode(jsonString).length;
    docSizeEl.textContent = `${formatBytes(byteLength)} / ${formatBytes(limits.maxDocumentBytes)}`;

    // Limit warning
    const elemRatio = elements.length / limits.maxElements;
    const byteRatio = byteLength / limits.maxDocumentBytes;
    if (elemRatio >= 1.0 || byteRatio >= 1.0) {
      limitBadgeEl.style.display = 'inline-block';
      limitBadgeEl.className = 'stat-badge error';
      limitBadgeEl.textContent = '⛔ Melebihi Batas';
    } else if (elemRatio >= 0.8 || byteRatio >= 0.8) {
      limitBadgeEl.style.display = 'inline-block';
      limitBadgeEl.className = 'stat-badge warn';
      limitBadgeEl.textContent = '⚠️ Mendekati Batas (≥80%)';
    } else {
      limitBadgeEl.style.display = 'none';
    }
  }

  function updateRuntime(): void {
    activeToolEl.textContent = board.tool ?? '(tidak ada)';

    const cam = board.getCamera();
    cameraStateEl.textContent = `(${Math.round(cam.x)}, ${Math.round(cam.y)}) ${Math.round(cam.zoom * 100)}%`;

    const sel = board.selection;
    selectionIdsEl.textContent = sel.length > 0 ? sel.join(', ') : '(kosong)';

    const bounds = board.selectionBounds;
    if (!bounds) {
      selectionBoundsEl.textContent = '-';
    } else {
      const w = Math.round(bounds.maxX - bounds.minX);
      const h = Math.round(bounds.maxY - bounds.minY);
      selectionBoundsEl.textContent = `${w}×${h} @ (${Math.round(bounds.minX)}, ${Math.round(bounds.minY)})`;
    }
  }

  function getRecordsForActivePage(): BoardRecord[] {
    const doc = board.getDocument();
    const activePageId = board.pages.current;
    const records = Object.values(doc.records);

    return records.filter((rec) => {
      if (rec.kind === 'element') return rec.pageId === activePageId;
      if (rec.kind === 'page') return rec.id === activePageId;
      if (rec.kind === 'binding') {
        // Show binding if either endpoint belongs to an element on active page
        const fromEl = doc.records[rec.fromId];
        const toEl = doc.records[rec.toId];
        return (
          (fromEl?.kind === 'element' && fromEl.pageId === activePageId) ||
          (toEl?.kind === 'element' && toEl.pageId === activePageId)
        );
      }
      return true;
    });
  }

  function renderRecordList(): void {
    const activeRecords = getRecordsForActivePage();
    const filtered = activeRecords.filter((rec) => {
      // Type filter
      if (typeFilter !== 'all') {
        if (typeFilter === 'binding' && rec.kind !== 'binding') return false;
        if (typeFilter === 'page' && rec.kind !== 'page') return false;
        if (['sticky', 'draw', 'text', 'geo'].includes(typeFilter)) {
          if (rec.kind !== 'element' || rec.type !== typeFilter) return false;
        }
      }

      // Search filter
      if (searchQuery) {
        const idMatch = rec.id.toLowerCase().includes(searchQuery);
        const typeMatch = (rec.kind === 'element' ? rec.type : rec.kind).toLowerCase().includes(searchQuery);
        const snippet = getRecordSnippet(rec).toLowerCase();
        const snippetMatch = snippet.includes(searchQuery);
        let propsMatch = false;
        if (rec.kind === 'element' && rec.props) {
          try {
            propsMatch = JSON.stringify(rec.props).toLowerCase().includes(searchQuery);
          } catch {}
        }
        if (!idMatch && !typeMatch && !snippetMatch && !propsMatch) return false;
      }

      return true;
    });

    recordListContainer.replaceChildren();

    if (filtered.length === 0) {
      recordListContainer.append(h('div', { class: 'empty-state' }, 'Tidak ada record yang sesuai filter.'));
      return;
    }

    const currentSelection = board.selection;

    for (const rec of filtered) {
      const typeLabel = rec.kind === 'element' ? rec.type : rec.kind;
      const snippet = getRecordSnippet(rec);
      const isSelected = currentSelection.includes(rec.id) || selectedRecordId === rec.id;

      const itemEl = h(
        'div',
        {
          class: `record-item${isSelected ? ' selected' : ''}`,
          dataset: { id: rec.id },
          onclick: () => {
            selectRecord(rec, true);
          },
        },
        h(
          'div',
          { class: 'record-item-meta' },
          h('span', { class: 'record-badge' }, typeLabel),
          h('span', { class: 'record-id' }, rec.id),
        ),
        h('span', { class: 'record-snippet', title: snippet }, snippet),
      );

      recordListContainer.append(itemEl);
    }
  }

  function selectRecord(rec: BoardRecord, selectOnBoard: boolean): void {
    selectedRecordId = rec.id;
    editorHeaderId.textContent = rec.id;
    editorHeaderType.textContent = rec.kind === 'element' ? rec.type : rec.kind;
    textarea.value = JSON.stringify(rec, null, 2);
    setStatus(null);

    // Update selected class in DOM
    for (const el of recordListContainer.children) {
      if (el instanceof HTMLElement) {
        el.classList.toggle('selected', el.dataset.id === rec.id);
      }
    }

    if (selectOnBoard && rec.kind === 'element') {
      board.select([rec.id]);

      // Center camera on the element if viewport is available
      const vp = board.camera.viewport;
      const cam = board.getCamera();
      if (vp.width > 0 && vp.height > 0) {
        board.setCamera({
          x: rec.x + rec.w / 2 - vp.width / 2 / cam.zoom,
          y: rec.y + rec.h / 2 - vp.height / 2 / cam.zoom,
        });
      }
    }
  }

  function syncSelectionFromBoard(): void {
    const sel = board.selection;
    if (sel.length > 0) {
      const firstId = sel[0]!;
      const doc = board.getDocument();
      const rec = doc.records[firstId];
      if (rec) {
        selectedRecordId = rec.id;
        editorHeaderId.textContent = rec.id;
        editorHeaderType.textContent = rec.kind === 'element' ? rec.type : rec.kind;

        // If user is not currently editing textarea, update its content
        if (document.activeElement !== textarea) {
          textarea.value = JSON.stringify(rec, null, 2);
          setStatus(null);
        }
      }
    }

    // Highlight and scroll matching items in list
    let firstScrolled = false;
    for (const el of recordListContainer.children) {
      if (el instanceof HTMLElement) {
        const id = el.dataset.id;
        const isMatch = id !== undefined && (sel.includes(id) || selectedRecordId === id);
        el.classList.toggle('selected', isMatch);
        if (isMatch && !firstScrolled) {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          firstScrolled = true;
        }
      }
    }
  }

  function applyEditorChanges(): void {
    if (!selectedRecordId) {
      setStatus('error', 'Pilih record terlebih dahulu sebelum menerapkan perubahan.');
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(textarea.value);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error', `JSON tidak valid: ${msg}`);
      return;
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setStatus('error', 'Isi JSON harus berupa objek.');
      return;
    }

    const doc = board.getDocument();
    const current = doc.records[selectedRecordId];
    if (!current) {
      setStatus('error', `Record dengan id "${selectedRecordId}" tidak ditemukan di dokumen.`);
      return;
    }

    if (current.kind === 'element') {
      // Build safe patch for board.update
      const patch: Record<string, unknown> = {};
      const allowedKeys = [
        'pageId',
        'parentId',
        'index',
        'x',
        'y',
        'rotation',
        'w',
        'h',
        'locked',
        'opacity',
        'props',
        'meta',
      ];
      for (const key of allowedKeys) {
        if (key in parsed) patch[key] = parsed[key];
      }

      let errorMsg: string | null = null;
      const offErr = board.on('error', (err) => {
        errorMsg = err.message;
        if (err.cause && typeof err.cause === 'object') {
          try {
            errorMsg += ` (${JSON.stringify(err.cause)})`;
          } catch {}
        }
      });

      let updated: ElementRecord | undefined;
      try {
        updated = board.update(selectedRecordId, patch);
      } catch (err: unknown) {
        errorMsg = err instanceof Error ? err.message : String(err);
      } finally {
        offErr();
      }

      if (errorMsg || !updated) {
        setStatus('error', errorMsg ?? 'Perubahan ditolak oleh skema atau elemen terkunci.');
      } else {
        setStatus('ok', 'Perubahan berhasil diterapkan.');
        textarea.value = JSON.stringify(updated, null, 2);
      }
    } else if (current.kind === 'page') {
      if (typeof parsed.name === 'string' && parsed.name !== current.name) {
        board.pages.rename(current.id, parsed.name);
        setStatus('ok', 'Nama halaman berhasil diubah.');
      } else {
        setStatus('ok', 'Halaman diperbarui.');
      }
    } else {
      try {
        board.transact((tx) => {
          tx.put(parsed as unknown as BoardRecord);
        });
        setStatus('ok', 'Record berhasil diperbarui.');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus('error', `Gagal memperbarui record: ${msg}`);
      }
    }

    updateStats();
    renderRecordList();
  }

  function resetEditorContent(): void {
    if (!selectedRecordId) {
      textarea.value = '';
      setStatus(null);
      return;
    }
    const doc = board.getDocument();
    const current = doc.records[selectedRecordId];
    if (current) {
      textarea.value = JSON.stringify(current, null, 2);
      setStatus(null);
    } else {
      textarea.value = '';
      setStatus('warn', 'Record tidak lagi tersedia di dokumen.');
    }
  }

  function update(): void {
    updateStats();
    updateRuntime();
    renderRecordList();
    syncSelectionFromBoard();
  }

  // ---------- Initial Render & Subscriptions ----------
  update();

  const offChange = board.on('change', () => {
    updateStats();
    renderRecordList();
    if (selectedRecordId && document.activeElement !== textarea) {
      const rec = board.getDocument().records[selectedRecordId];
      if (rec) textarea.value = JSON.stringify(rec, null, 2);
    }
  });

  const offSelection = board.on('selection', () => {
    updateRuntime();
    syncSelectionFromBoard();
  });

  const offCamera = board.on('camera', () => {
    updateRuntime();
  });

  const offTool = board.on('tool', () => {
    updateRuntime();
  });

  const offPage = board.on('page', () => {
    update();
  });

  return {
    update,
    dispose() {
      offChange();
      offSelection();
      offCamera();
      offTool();
      offPage();
    },
  };
}
