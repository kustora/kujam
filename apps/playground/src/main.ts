import { createBoard } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import { DEFAULT_ELEMENT_TYPES, DEFAULT_TOOL_IDS } from '@kujam/shapes';

const params = new URLSearchParams(window.location.search);
const isBare = params.get('bare') === '1';
const scenarioPath = window.location.pathname.startsWith('/s/')
  ? window.location.pathname.slice(3)
  : 'empty';

const app = document.getElementById('app');
if (!app) {
  throw new Error('Root element #app tidak ditemukan');
}

app.innerHTML = `
  <div class="playground-shell" data-bare="${isBare}">
    <header class="topbar">
      <div>
        <strong>@kujam/* Playground</strong>
        <span class="badge" style="margin-left: 8px;">Skenario: ${scenarioPath}</span>
      </div>
      <div>
        <span>Elemen bawaan: ${DEFAULT_ELEMENT_TYPES.length} · Tool: ${DEFAULT_TOOL_IDS.length}</span>
      </div>
    </header>
    <aside class="panel-left">
      <h3 style="margin-bottom: 8px; font-size: 14px;">Kontrol Konfigurasi</h3>
      <p style="color: #94a3b8; line-height: 1.5;">
        Panel kontrol skenario, adapter, tema, dan snap grid (BOARD-2401 / BOARD-2402).
      </p>
    </aside>
    <main class="canvas-stage" id="board-host"></main>
    <aside class="panel-right">
      <h3 style="margin-bottom: 8px; font-size: 14px;">Inspector Dokumen</h3>
      <pre id="doc-inspector"></pre>
    </aside>
  </div>
`;

const board = createBoard({ locale: 'id' });
const host = document.getElementById('board-host');
if (host) {
  mountRenderer(board, host);
}

const inspector = document.getElementById('doc-inspector');
if (inspector) {
  inspector.textContent = JSON.stringify(board.getDocument(), null, 2);
}

