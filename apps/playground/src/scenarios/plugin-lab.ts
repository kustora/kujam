/**
 * Live plugin lab (BOARD-2412): write `defineElement`, `defineTool`, `defineBrush`, or
 * `definePlugin` code in a CodeMirror editor; it is transpiled in the browser (sucrase) and
 * re-installed on the board without reloading the page. Errors show in the issue panel and the
 * board keeps the last working version.
 *
 * The lab component (`src/plugin-lab/`) and its heavy dependencies are loaded lazily, so other
 * scenarios neither download them nor need `eval` under the strict CSP of `?csp=1` (this scenario
 * does need it, see `docs/csp.md`).
 *
 * Query: `example=<id>` picks the starting example. The edited source of each example is kept as
 * a per-browser draft. In test mode the lab is exposed as `window.__pluginLab`.
 */

import type { Board } from '@kujam/core';
import { h, json, section } from '../dom.js';
import type { PluginLab } from '../plugin-lab/index.js';
import { defineScenario } from '../scenario.js';

declare global {
  interface Window {
    /** Live plugin lab, in test mode. */
    __pluginLab?: PluginLab;
  }
}

const DRAFT_KEY = 'kujam.plugin-lab.draft:';

function readDraft(id: string): string | null {
  try {
    return localStorage.getItem(DRAFT_KEY + id);
  } catch {
    return null;
  }
}

function writeDraft(id: string, source: string | null): void {
  try {
    if (source === null) localStorage.removeItem(DRAFT_KEY + id);
    else localStorage.setItem(DRAFT_KEY + id, source);
  } catch {
    // Drafts are a convenience; private windows may refuse storage.
  }
}

export default defineScenario({
  id: 'plugin-lab',
  title: 'Lab plugin live',
  description:
    'Editor kode untuk defineElement, defineTool, defineBrush, dan definePlugin: transpilasi di browser dan pasang ulang tanpa memuat ulang halaman.',
  order: 31,
  layout: 'lab',
  mount({ main, controls, debug, state, expose }) {
    const testMode = new URL(location.href).searchParams.get('test') === '1';
    let lab: PluginLab | null = null;
    let cancelled = false;

    const loading = h('p', { class: 'muted', style: 'padding: 24px' }, 'Memuat editor…');
    main.append(loading);

    void import('../plugin-lab/index.js')
      .then(({ LAB_EXAMPLES, findExample, mountPluginLab }) => {
        if (cancelled) return;
        loading.remove();
        let example = findExample(state.get('example')) ?? LAB_EXAMPLES[0]!;

        // ---------- Debug: what the user code installed ----------
        const installedBox = h('pre', {}, '');
        const boardBox = h('pre', {}, '');
        function renderInstalled(): void {
          if (!lab) return;
          installedBox.textContent = json(
            lab.session.userPlugins.map((p) => ({
              id: p.id,
              elements: p.elements?.map((e) => e.type) ?? [],
              tools: p.tools?.map((t) => t.id) ?? [],
              brushes: p.brushes?.map((b) => b.id) ?? [],
              commands: Object.keys(p.commands ?? {}),
              setup: typeof p.setup === 'function',
            })),
          );
          const b = lab.board;
          boardBox.textContent = json({
            elements: Object.values(b.getDocument().records).filter((r) => r.kind === 'element')
              .length,
            tool: b.tool,
            camera: b.getCamera(),
          });
        }

        // ---------- Controls: try what the code registered ----------
        const tryBox = h('div', { style: 'display: grid; gap: 8px' });
        function renderTry(board: Board): void {
          if (!lab) return;
          const plugins = lab.session.userPlugins;
          const elements = plugins.flatMap((p) => p.elements ?? []);
          const tools = plugins.flatMap((p) => p.tools ?? []);
          const brushes = plugins.flatMap((p) => p.brushes ?? []);
          const small = 'padding: 2px 8px; font-size: 12px';
          const rows: HTMLElement[] = [];
          for (const def of elements) {
            rows.push(
              h(
                'div',
                { class: 'row' },
                h('code', { style: 'flex: 1; min-width: 0' }, def.type),
                h(
                  'button',
                  {
                    type: 'button',
                    style: small,
                    onclick: () => {
                      const view = board.camera.getViewportBounds();
                      const w = 240;
                      const hgt = 120;
                      board.create({
                        type: def.type,
                        x: view.minX + (view.maxX - view.minX - w) / 2,
                        y: view.minY + (view.maxY - view.minY - hgt) / 2,
                        w,
                        h: hgt,
                      });
                    },
                  },
                  'Tambah',
                ),
              ),
            );
          }
          for (const tool of tools) {
            rows.push(
              h(
                'div',
                { class: 'row' },
                h('code', { style: 'flex: 1; min-width: 0' }, tool.id),
                h(
                  'button',
                  { type: 'button', style: small, onclick: () => board.setTool(tool.id) },
                  'Aktifkan',
                ),
              ),
            );
          }
          for (const brush of brushes) {
            rows.push(
              h(
                'div',
                { class: 'row' },
                h('code', { style: 'flex: 1; min-width: 0' }, brush.id),
                h(
                  'button',
                  {
                    type: 'button',
                    style: small,
                    onclick: () => {
                      board.toolStyles.set('draw', { brush: brush.id });
                      board.setTool('draw');
                    },
                  },
                  'Pakai',
                ),
              ),
            );
          }
          tryBox.replaceChildren(
            ...(rows.length > 0
              ? rows
              : [h('p', { class: 'muted' }, 'Kode belum mendaftarkan elemen, tool, atau kuas.')]),
          );
        }

        const exampleSelect = h(
          'select',
          {
            'aria-label': 'Contoh',
            onchange: () => {
              const next = findExample(exampleSelect.value);
              if (!next || !lab) return;
              example = next;
              state.set('example', next.id);
              exampleInfo.textContent = next.description;
              lab.setSource(readDraft(next.id) ?? next.source);
            },
          },
          ...LAB_EXAMPLES.map((e) =>
            h('option', { value: e.id, selected: e.id === example.id }, e.title),
          ),
        );
        const exampleInfo = h('p', { class: 'muted' }, example.description);

        controls.append(
          section(
            'Contoh',
            exampleSelect,
            exampleInfo,
            h(
              'div',
              { class: 'row wrap' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'ghost',
                  title: 'Buang perubahan dan muat ulang kode contoh ini',
                  onclick: () => {
                    writeDraft(example.id, null);
                    lab?.setSource(example.source);
                  },
                },
                'Reset contoh',
              ),
              h(
                'button',
                {
                  type: 'button',
                  class: 'ghost',
                  title: 'Lepas plugin pengguna; dokumen tetap',
                  onclick: () => {
                    lab?.session.reset();
                    if (lab) renderTry(lab.board);
                    renderInstalled();
                  },
                },
                'Lepas plugin',
              ),
            ),
          ),
          section('Coba', tryBox),
          section(
            'Cara kerja',
            h(
              'p',
              { class: 'muted' },
              'Kode ditranspilasi dengan sucrase lalu dievaluasi; impor ',
              h('code', {}, '@kujam/core'),
              ' dan ',
              h('code', {}, '@kujam/shapes'),
              ' memakai modul asli. Setiap pemasangan ulang membuat papan baru dari dokumen yang sama (kamera, seleksi, dan tool dibawa), lalu papan lama dibuang beserta teardown plugin-nya. Riwayat undo dimulai ulang.',
            ),
            h(
              'p',
              { class: 'muted' },
              'Butuh eval: hanya untuk playground, tidak berjalan di bawah CSP ketat.',
            ),
          ),
        );
        debug.append(
          section('Plugin pengguna terpasang', installedBox),
          section('Papan', boardBox),
        );

        let offs: (() => void)[] = [];
        lab = mountPluginLab(main, {
          source: readDraft(example.id) ?? example.source,
          boardOptions: { locale: 'id' },
          seed: (board) => {
            board.create({
              type: 'sticky',
              x: 80,
              y: 80,
              w: 200,
              h: 200,
              props: { text: [{ insert: 'Edit kode di kiri; papan dipasang ulang.\n' }] },
            });
            board.history.clear();
          },
          onBoard: (board) => {
            for (const off of offs) off();
            offs = [board.on('change', renderInstalled), board.on('tool', renderInstalled)];
            expose(board);
            // `lab` is still null for the first board; the code below renders it.
            if (lab) {
              renderTry(board);
              renderInstalled();
            }
          },
          onSourceChange: (source) =>
            writeDraft(example.id, source === example.source ? null : source),
        });
        renderTry(lab.board);
        renderInstalled();
        if (testMode) {
          window.__pluginLab = lab;
          // The playground shell sets this after a synchronous mount; this scenario mounts late.
          document.documentElement.dataset.boardReady = 'true';
        }

        cleanupLab = () => {
          for (const off of offs) off();
          offs = [];
        };
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        loading.textContent = `Gagal memuat lab: ${String(error)}`;
      });

    let cleanupLab = (): void => {};
    return () => {
      cancelled = true;
      cleanupLab();
      lab?.destroy();
      lab = null;
      if (testMode) delete window.__pluginLab;
    };
  },
});
