/**
 * The app chrome around the board, laid out like Excalidraw: the main menu at the top left, the
 * tools at the bottom center, sharing and people at the top right, zoom and undo at the bottom left,
 * and help at the bottom right. The tools, zoom, undo/redo, selection toolbar, context menu,
 * command palette, presence bar, and shortcut help are the `@kujam/ui` components; this file only
 * places them and adds the menu, dialogs, and messages.
 */

import { createTheme, type Board, type PresenceUser, type ThemeDefinition } from '@kujam/core';
import {
  exportJSON,
  exportPDF,
  exportPNG,
  exportSVG,
  importExcalidraw,
  importJSON,
} from '@kujam/export';
import type { BoardBackground, BoardView } from '@kujam/renderer';
import type { MountedUi, ShortcutHelpElement } from '@kujam/ui';
import type { ConnectionState } from './collab.js';
import { download, h, icon, storage, type IconName } from './dom.js';

export type ThemeMode = 'light' | 'dark';

const THEME_KEY = 'kujam-sketch-theme';
const BACKGROUND_KEY = 'kujam-sketch-background';

export function initialTheme(): ThemeMode {
  const stored = storage.get(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function initialBackground(): BoardBackground {
  const stored = storage.get(BACKGROUND_KEY);
  return stored === 'dots' || stored === 'grid' || stored === 'none' ? stored : 'none';
}

/** Font of the app, the UI components, and text on the board (loaded from Google Fonts). */
export const FONT_FAMILY = "'Playpen Sans', ui-sans-serif, system-ui, sans-serif";

/** Board theme in the app font: rich text on canvas, the text editor, and exports use it. */
export function boardTheme(mode: ThemeMode): Readonly<ThemeDefinition> {
  return createTheme(mode, { id: `sketch-${mode}`, typography: { fontFamily: FONT_FAMILY } });
}

/**
 * Waits until the font is ready (at most `timeoutMs`), so the first layout of board text is not
 * measured with a fallback font.
 */
export async function loadFont(timeoutMs = 1500): Promise<void> {
  if (!('fonts' in document)) return;
  const fonts = Promise.all([
    document.fonts.load("400 16px 'Playpen Sans'"),
    document.fonts.load("700 16px 'Playpen Sans'"),
  ]).catch(() => undefined);
  await Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}

export function applyPageTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
}

export interface ChromeOptions {
  readonly root: HTMLElement;
  readonly board: Board;
  readonly view: BoardView;
  readonly ui: MountedUi;
  /** `local`: saved in this browser; `room`: connected to a shared room. */
  readonly mode: 'local' | 'room';
  readonly readOnly: boolean;
  readonly user: PresenceUser;
  /** Opens the share dialog (start a session, or show the links of this one). */
  readonly onShare: () => void;
  /** Saves the document under this name. */
  readonly fileName: () => string;
}

export interface Chrome {
  toast(message: string, kind?: 'info' | 'error'): void;
  setConnection(state: ConnectionState, detail?: string): void;
  setPeers(peers: readonly PresenceUser[]): void;
  setBanner(text: string | null): void;
}

type MenuEntry =
  | {
      readonly label: string;
      readonly icon: IconName;
      readonly run: () => void | Promise<void>;
      readonly shortcut?: string;
      readonly disabled?: boolean;
    }
  | 'separator'
  | HTMLElement;

/** Places the `@kujam/ui` components for this layout. */
function arrangeUi(
  ui: MountedUi,
  layers: { bottomLeft: HTMLElement; topRight: HTMLElement },
): void {
  // Tools at the bottom center, level with zoom and undo/redo.
  Object.assign(ui.toolbar.style, { bottom: '16px' });
  // Static inside the app's own flex rows instead of absolutely placed.
  for (const el of [ui.zoom, ui.history]) {
    Object.assign(el.style, { position: 'static', transform: 'none' });
    layers.bottomLeft.append(el);
  }
  Object.assign(ui.presence.style, { position: 'static' });
  layers.topRight.prepend(ui.presence);
  // Excalidraw has no minimap; it stays available through the command palette's zoom commands.
  ui.minimap.hidden = true;
}

export function mountChrome(options: ChromeOptions): Chrome {
  const { root, board, view, ui, readOnly } = options;

  const topLeft = h('div', { class: 'sk-layer sk-top-left' });
  const topRight = h('div', { class: 'sk-layer sk-top-right' });
  const bottomLeft = h('div', { class: 'sk-layer sk-bottom-left' });
  const bottomRight = h('div', { class: 'sk-layer sk-bottom-right' });
  const banner = h('div', { class: 'sk-banner', hidden: true, role: 'status' });
  const toastEl = h('div', {
    class: 'sk-toast',
    hidden: true,
    role: 'status',
    'aria-live': 'polite',
  });
  arrangeUi(ui, { bottomLeft, topRight });

  // ---------- Messages ----------
  let toastTimer = 0;
  function toast(message: string, kind: 'info' | 'error' = 'info'): void {
    toastEl.textContent = message;
    toastEl.className = kind === 'error' ? 'sk-toast error' : 'sk-toast';
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), kind === 'error' ? 6000 : 3500);
  }
  function setBanner(text: string | null): void {
    banner.textContent = text ?? '';
    banner.hidden = text === null;
  }

  // ---------- Theme and background ----------
  function setTheme(mode: ThemeMode): void {
    storage.set(THEME_KEY, mode);
    applyPageTheme(mode);
    view.setTheme(boardTheme(mode));
    renderMenu();
  }
  function setBackground(background: BoardBackground): void {
    storage.set(BACKGROUND_KEY, background);
    view.background = background;
    renderMenu();
  }

  // ---------- Files ----------
  async function openFile(): Promise<void> {
    const input = h('input', { type: 'file', accept: '.json,.excalidraw,application/json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text()) as { type?: unknown };
        if (data?.type === 'excalidraw' || data?.type === 'excalidraw/clipboard') {
          const result = importExcalidraw(board, data);
          const skipped = result.unsupported.length;
          toast(
            `${result.ids.length} elemen dari Excalidraw diimpor` +
              (skipped ? `; ${skipped} tidak didukung dan dilewati.` : '.'),
          );
        } else {
          const result = importJSON(board, data);
          toast(`${result.ids.length} elemen diimpor.`);
        }
        board.camera.zoomToFit();
      } catch (error) {
        toast(
          `Gagal membuka berkas: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
      }
    });
    input.click();
  }

  async function runExport(kind: 'png' | 'svg' | 'pdf'): Promise<void> {
    const name = options.fileName();
    try {
      if (kind === 'png') {
        const result = await exportPNG(board, { scale: 2 });
        download(result.data, `${name}.png`);
      } else if (kind === 'svg') {
        const result = await exportSVG(board);
        download(new Blob([result.data], { type: result.mimeType }), `${name}.svg`);
      } else {
        const result = await exportPDF(board, { title: name });
        download(result.data, `${name}.pdf`);
        toast(`PDF ${result.pageCount} halaman diunduh.`);
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      toast(
        code === 'nothing-to-export'
          ? 'Papan masih kosong; tidak ada yang bisa diekspor.'
          : `Ekspor gagal: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    }
  }

  function clearCanvas(): void {
    const ids = board
      .query({})
      .filter((el) => el.parentId === null)
      .map((el) => el.id);
    if (ids.length === 0) return;
    const shared =
      options.mode === 'room' ? ' Semua orang di room ini juga akan kehilangannya.' : '';
    if (!confirm(`Hapus semua ${ids.length} elemen di kanvas?${shared}`)) return;
    board.delete(ids);
    toast('Kanvas dibersihkan. Tekan Ctrl/⌘+Z untuk membatalkan.');
  }

  const openPalette = (): void => (ui.commandPalette as unknown as { open(): void }).open();
  const openHelp = (): void => (ui.shortcutHelp as unknown as ShortcutHelpElement).open();

  // ---------- Main menu ----------
  const menuButton = h('button', {
    class: 'sk-icon-button',
    type: 'button',
    'aria-label': 'Menu utama',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    title: 'Menu',
  });
  menuButton.append(icon('menu'));
  const menu = h('div', { class: 'sk-island sk-menu', role: 'menu', hidden: true });
  const menuWrap = h('div', { style: 'position:relative' }, menuButton, menu);
  topLeft.append(menuWrap);

  let menuOpen = false;
  function setMenuOpen(open: boolean): void {
    menuOpen = open;
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) {
      renderMenu();
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  }
  menuButton.addEventListener('click', () => setMenuOpen(!menuOpen));
  document.addEventListener('pointerdown', (event) => {
    if (menuOpen && !menuWrap.contains(event.target as Node)) setMenuOpen(false);
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setMenuOpen(false);
      menuButton.focus();
    }
  });

  function segmented<T extends string>(
    label: string,
    value: T,
    choices: readonly (readonly [T, string])[],
    pick: (value: T) => void,
  ): HTMLElement {
    const row = h('div', { class: 'sk-segmented', role: 'group', 'aria-label': label });
    for (const [choice, text] of choices) {
      row.append(
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(choice === value),
            onclick: () => pick(choice),
          },
          text,
        ),
      );
    }
    return h('div', {}, h('div', { class: 'sk-menu-label' }, label), row);
  }

  function renderMenu(): void {
    const theme = (document.documentElement.dataset.theme as ThemeMode) ?? 'light';
    const entries: MenuEntry[] = [
      { label: 'Buka atau impor…', icon: 'open', run: openFile, disabled: readOnly },
      {
        label: 'Simpan ke berkas',
        icon: 'save',
        run: () =>
          download(
            new Blob([JSON.stringify(exportJSON(board), null, 2)], { type: 'application/json' }),
            `${options.fileName()}.kujam.json`,
          ),
      },
      { label: 'Ekspor PNG', icon: 'image', run: () => runExport('png') },
      { label: 'Ekspor SVG', icon: 'image', run: () => runExport('svg') },
      { label: 'Ekspor PDF (per frame)', icon: 'file', run: () => runExport('pdf') },
      'separator',
      { label: 'Kolaborasi langsung…', icon: 'users', run: options.onShare },
      { label: 'Palet perintah', icon: 'command', run: openPalette, shortcut: '/' },
      { label: 'Pintasan keyboard', icon: 'keyboard', run: openHelp, shortcut: '?' },
      { label: 'Bersihkan kanvas', icon: 'trash', run: clearCanvas, disabled: readOnly },
      'separator',
      segmented(
        'Tema',
        theme,
        [
          ['light', 'Terang'],
          ['dark', 'Gelap'],
        ] as const,
        setTheme,
      ),
      segmented(
        'Latar kanvas',
        view.background,
        [
          ['none', 'Polos'],
          ['dots', 'Titik'],
          ['grid', 'Grid'],
        ] as const,
        setBackground,
      ),
      'separator',
      h(
        'a',
        {
          class: 'sk-menu-item',
          href: 'https://github.com/kustora/kujam',
          target: '_blank',
          rel: 'noopener noreferrer',
          role: 'menuitem',
        },
        icon('github'),
        'kujam di GitHub',
      ),
    ];
    menu.replaceChildren(
      ...entries.map((entry) => {
        if (entry === 'separator')
          return h('div', { class: 'sk-menu-separator', role: 'separator' });
        if (entry instanceof HTMLElement) return entry;
        const button = h(
          'button',
          {
            class: 'sk-menu-item',
            type: 'button',
            role: 'menuitem',
            disabled: entry.disabled ?? false,
            onclick: () => {
              setMenuOpen(false);
              void entry.run();
            },
          },
          icon(entry.icon),
          entry.label,
          entry.shortcut ? h('span', { class: 'sk-shortcut' }, entry.shortcut) : null,
        );
        return button;
      }),
    );
  }
  renderMenu();

  // ---------- Share button ----------
  const dot = h('span', {
    class: 'sk-dot',
    'data-state': 'connecting',
    hidden: options.mode !== 'room',
  });
  const count = h('span', { class: 'sk-badge', hidden: true });
  const shareButton = h(
    'button',
    {
      class: 'sk-button primary',
      type: 'button',
      onclick: options.onShare,
      title: options.mode === 'room' ? 'Link dan orang di room ini' : 'Mulai kolaborasi langsung',
    },
    icon('share'),
    h('span', { class: 'sk-share-label' }, options.mode === 'room' ? 'Room' : 'Bagikan'),
    dot,
    count,
  );
  topRight.append(shareButton);
  if (options.mode !== 'room') ui.presence.hidden = true;

  // ---------- Help ----------
  const helpButton = h('button', {
    class: 'sk-icon-button',
    type: 'button',
    'aria-label': 'Pintasan keyboard',
    title: 'Pintasan keyboard (?)',
    onclick: openHelp,
  });
  helpButton.append(icon('help'));
  bottomRight.append(helpButton);

  // ---------- Welcome screen ----------
  const welcome = h(
    'div',
    { class: 'sk-welcome', hidden: true },
    h('div', { class: 'sk-hint menu' }, '↖ Buka, simpan, ekspor, dan tema'),
    h('div', { class: 'sk-hint tools' }, '↓ Pilih alat, lalu mulai menggambar'),
    h(
      'div',
      {},
      h('h1', {}, 'kujam sketch'),
      h('p', {}, 'Semua tersimpan di browser ini. Bagikan papan untuk menggambar bersama.'),
      h(
        'div',
        { class: 'sk-welcome-actions' },
        welcomeItem('open', 'Buka atau impor berkas', openFile),
        welcomeItem('users', 'Kolaborasi langsung', options.onShare),
        welcomeItem('keyboard', 'Pintasan keyboard', openHelp),
      ),
    ),
  );
  function welcomeItem(
    name: IconName,
    label: string,
    run: () => void | Promise<void>,
  ): HTMLElement {
    return h(
      'button',
      { class: 'sk-menu-item', type: 'button', onclick: () => void run() },
      icon(name),
      label,
    );
  }
  const updateWelcome = (): void => {
    welcome.hidden = options.mode !== 'local' || board.query({}).length > 0;
  };
  board.on('change', updateWelcome);
  board.on('page', updateWelcome);
  updateWelcome();

  root.append(welcome, topLeft, topRight, bottomLeft, bottomRight, banner, toastEl);

  // Shortcuts work right away, like in Excalidraw: the board has focus from the start, and keys
  // pressed while nothing else has focus (after a menu or dialog closed) go to the board.
  const boardRoot = view.layers.root;
  boardRoot.focus({ preventScroll: true });
  document.addEventListener('keydown', (event) => {
    if (document.activeElement !== document.body || event.defaultPrevented) return;
    boardRoot.focus({ preventScroll: true });
    boardRoot.dispatchEvent(new KeyboardEvent('keydown', event));
    event.preventDefault();
  });
  // Viewers cannot draw, so the drawing tools are hidden and their shortcuts fall back to
  // selecting; selecting, panning, and exporting still work.
  if (readOnly) {
    ui.toolbar.hidden = true;
    const VIEW_TOOLS = new Set(['select', 'hand', 'lasso']);
    board.on('tool', ({ id }) => {
      if (id !== null && !VIEW_TOOLS.has(id)) board.setTool('select');
    });
  }
  if (readOnly)
    setBanner('Mode lihat saja: kamu bisa melihat dan menggeser kanvas, tapi tidak mengubahnya.');

  return {
    toast,
    setBanner,
    setConnection(state, detail) {
      dot.dataset.state = state;
      dot.title =
        state === 'connected'
          ? 'Tersambung'
          : state === 'error'
            ? (detail ?? 'Gagal tersambung')
            : 'Menyambung…';
    },
    setPeers(peers) {
      count.textContent = String(peers.length);
      count.hidden = options.mode !== 'room' || peers.length < 2;
    },
  };
}
