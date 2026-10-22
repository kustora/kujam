/**
 * Live plugin lab component (BOARD-2412): a code editor, a live board, and an issue panel.
 *
 * Write `defineElement`, `defineTool`, `defineBrush`, or `definePlugin` code; it is transpiled in
 * the browser and re-installed on the board on every change (debounced) or on Mod-Enter, without
 * reloading the page. Compile, install, and runtime errors are listed in the issue panel and
 * underlined in the editor; the board keeps running the last working version.
 *
 * Self-contained (no playground globals), so the documentation playground (BOARD-2205) can mount
 * it without the playground's debug panels.
 *
 * Needs `eval` (`docs/csp.md`): development and documentation pages only.
 */

import * as core from '@kujam/core';
import type { AnyPluginDefinition, Board, CreateBoardOptions } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';
import * as shapes from '@kujam/shapes';
import { attachTextEditor } from '@kujam/shapes';
import { mountDefaultUi } from '@kujam/ui';
import { mountCodeEditor, type CodeEditor } from './code-editor.js';
import {
  issueFrom,
  locateInSource,
  wasReported,
  type LabIssue,
  type LabModules,
} from './runtime.js';
import { createPluginLabSession, type ApplyResult, type PluginLabSession } from './session.js';
import './plugin-lab.css';

/** Modules user code can import by default. */
export const DEFAULT_LAB_MODULES: LabModules = Object.freeze({
  '@kujam/core': core,
  '@kujam/shapes': shapes,
});

/** Plugins installed under the user's by default: commands, built-in elements, and tools. */
export const DEFAULT_LAB_PLUGINS: readonly AnyPluginDefinition[] = Object.freeze([
  core.defaultCommands,
  shapes.defaultElements,
  shapes.defaultTools,
]);

/** Issue panel labels, per kind. */
const KIND_LABEL: Record<LabIssue['kind'], string> = {
  compile: 'Kompilasi',
  evaluate: 'Evaluasi',
  install: 'Pemasangan',
  runtime: 'Runtime',
  render: 'Render',
};

const MAX_ISSUES = 50;

export interface PluginLabOptions {
  /** Initial source. */
  readonly source: string;
  /** Re-install automatically after typing stops. Defaults to `true`. */
  readonly autoApply?: boolean;
  /** Debounce of automatic re-installs, in ms. Defaults to 600. */
  readonly debounceMs?: number;
  /** Defaults to {@link DEFAULT_LAB_PLUGINS}. */
  readonly basePlugins?: readonly AnyPluginDefinition[];
  /** Defaults to {@link DEFAULT_LAB_MODULES}. */
  readonly modules?: LabModules;
  readonly boardOptions?: Omit<CreateBoardOptions, 'plugins' | 'document'>;
  /** Fills the first board. */
  readonly seed?: (board: Board) => void;
  /**
   * Attaches a view to a board inside `host`; returns its detach function. Defaults to the
   * renderer with the text editor and the default UI.
   */
  readonly mountView?: (board: Board, host: HTMLElement) => () => void;
  /** Called with the initial board and after each re-install. */
  readonly onBoard?: (board: Board) => void;
  /** Called for every issue, after it is added to the panel. */
  readonly onIssue?: (issue: LabIssue) => void;
  /** Called on every editor change. */
  readonly onSourceChange?: (source: string) => void;
}

export interface PluginLab {
  readonly session: PluginLabSession;
  readonly editor: CodeEditor;
  /** Current board. */
  readonly board: Board;
  /** Issues in the panel, newest first. */
  readonly issues: readonly LabIssue[];
  /** Applies the editor content now. */
  apply(): ApplyResult;
  /** Replaces the editor content and applies it. */
  setSource(source: string): ApplyResult;
  setAutoApply(enabled: boolean): void;
  clearIssues(): void;
  /** Removes the lab and disposes its board. Idempotent. */
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function defaultMountView(board: Board, host: HTMLElement): () => void {
  const view = mountRenderer(board, host, { background: 'dots' });
  const text = attachTextEditor(view);
  const ui = mountDefaultUi({ board, container: host });
  return () => {
    ui.unmount();
    text.detach();
    view.unmount();
  };
}

/** Mounts the lab into `host` and installs `options.source`. */
export function mountPluginLab(host: HTMLElement, options: PluginLabOptions): PluginLab {
  const root = el('div', 'plugin-lab');
  const left = el('div', 'plugin-lab-code');
  const bar = el('div', 'plugin-lab-bar');
  const applyButton = el('button', '', 'Terapkan');
  applyButton.type = 'button';
  applyButton.title = 'Transpilasi dan pasang ulang ke papan (Ctrl/Cmd+Enter)';
  const autoLabel = el('label', 'plugin-lab-auto');
  const autoBox = el('input');
  autoBox.type = 'checkbox';
  autoBox.checked = options.autoApply ?? true;
  autoLabel.append(autoBox, ' Otomatis');
  const status = el('span', 'plugin-lab-status');
  status.setAttribute('role', 'status');
  bar.append(applyButton, autoLabel, status);

  const editorHost = el('div', 'plugin-lab-editor');
  const issuesBox = el('section', 'plugin-lab-issues');
  issuesBox.setAttribute('aria-label', 'Error kompilasi dan runtime');
  const issuesHead = el('div', 'plugin-lab-issues-head');
  const issuesTitle = el('strong', '', 'Error');
  const clearButton = el('button', 'ghost', 'Bersihkan');
  clearButton.type = 'button';
  issuesHead.append(issuesTitle, clearButton);
  const issuesList = el('ol', 'plugin-lab-issue-list');
  issuesBox.append(issuesHead, issuesList);
  left.append(bar, editorHost, issuesBox);

  const boardHost = el('div', 'plugin-lab-board');
  root.append(left, boardHost);
  host.append(root);

  let issues: LabIssue[] = [];
  /** Issues with a source line since the last apply, shown as editor diagnostics. */
  let located: LabIssue[] = [];
  let editor: CodeEditor | null = null;

  function renderIssues(): void {
    issuesTitle.textContent = issues.length > 0 ? `Error (${issues.length})` : 'Error';
    issuesBox.dataset.empty = String(issues.length === 0);
    issuesList.replaceChildren(
      ...(issues.length === 0
        ? [el('li', 'plugin-lab-issue-empty', 'Tidak ada error.')]
        : issues.map((issue) => {
            const item = el('li', 'plugin-lab-issue');
            item.dataset.kind = issue.kind;
            const head = el('div', 'plugin-lab-issue-head');
            head.append(el('span', 'plugin-lab-kind', KIND_LABEL[issue.kind]));
            if (issue.origin) head.append(el('code', '', issue.origin));
            if (issue.line !== undefined) {
              const jump = el('button', 'ghost plugin-lab-line', `baris ${issue.line}`);
              jump.type = 'button';
              jump.title = 'Ke baris ini di editor';
              jump.addEventListener('click', () => {
                if (!editor) return;
                const doc = editor.view.state.doc;
                const line = doc.line(Math.min(Math.max(1, issue.line!), doc.lines));
                editor.view.dispatch({
                  selection: { anchor: Math.min(line.from + (issue.column ?? 0), line.to) },
                  scrollIntoView: true,
                });
                editor.focus();
              });
              head.append(jump);
            }
            item.append(head, el('div', 'plugin-lab-message', issue.message));
            return item;
          })),
    );
  }

  function renderDiagnostics(): void {
    editor?.setDiagnostics(
      located.map((issue) => ({
        line: issue.line!,
        column: issue.column,
        message: `${KIND_LABEL[issue.kind]}: ${issue.message}`,
      })),
    );
  }

  function addIssue(issue: LabIssue): void {
    issues = [issue, ...issues].slice(0, MAX_ISSUES);
    if (issue.line !== undefined) {
      located = [...located, issue];
      renderDiagnostics();
    }
    renderIssues();
    options.onIssue?.(issue);
  }

  function setStatus(kind: 'ok' | 'error' | 'idle', text: string): void {
    status.dataset.state = kind;
    status.textContent = text;
  }

  const session = createPluginLabSession({
    basePlugins: options.basePlugins ?? DEFAULT_LAB_PLUGINS,
    modules: options.modules ?? DEFAULT_LAB_MODULES,
    boardOptions: options.boardOptions,
    seed: options.seed,
    mount: (board) => (options.mountView ?? defaultMountView)(board, boardHost),
    onIssue: addIssue,
    onBoard: (board) => options.onBoard?.(board),
  });
  options.onBoard?.(session.board);

  let timer: ReturnType<typeof setTimeout> | null = null;
  function cancelPending(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function apply(): ApplyResult {
    cancelPending();
    located = [];
    renderDiagnostics();
    const result = session.apply(editor?.getValue() ?? options.source);
    const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
    if (result.ok) {
      const ids = session.userPlugins.map((p) => p.id).join(', ');
      setStatus('ok', `Terpasang ${time}: ${ids}`);
    } else {
      setStatus('error', `Gagal ${time}: papan tetap memakai versi terakhir yang berhasil.`);
    }
    return result;
  }

  editor = mountCodeEditor(editorHost, {
    value: options.source,
    language: 'typescript',
    ariaLabel: 'Kode plugin',
    onRun: () => apply(),
    onChange: (source) => {
      options.onSourceChange?.(source);
      if (!autoBox.checked) {
        setStatus('idle', 'Ada perubahan: tekan Terapkan atau Ctrl/Cmd+Enter.');
        return;
      }
      cancelPending();
      timer = setTimeout(apply, options.debounceMs ?? 600);
    },
  });

  // Errors thrown later by user code (timers, event listeners) that no wrapper caught.
  const onWindowError = (event: ErrorEvent): void => {
    const error = event.error ?? event.message;
    if (wasReported(error) || !locateInSource(error)) return;
    session.report(issueFrom('runtime', error, 'uncaught'));
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    if (wasReported(event.reason) || !locateInSource(event.reason)) return;
    session.report(issueFrom('runtime', event.reason, 'unhandledrejection'));
  };
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onRejection);

  applyButton.addEventListener('click', () => apply());
  autoBox.addEventListener('change', () => {
    if (autoBox.checked) apply();
  });
  clearButton.addEventListener('click', () => lab.clearIssues());

  renderIssues();
  apply();

  let destroyed = false;
  const lab: PluginLab = {
    session,
    editor,
    get board() {
      return session.board;
    },
    get issues() {
      return issues;
    },
    apply,
    setSource(source) {
      editor!.setValue(source);
      options.onSourceChange?.(source);
      return apply();
    },
    setAutoApply(enabled) {
      autoBox.checked = enabled;
      if (!enabled) cancelPending();
    },
    clearIssues() {
      issues = [];
      located = [];
      renderDiagnostics();
      renderIssues();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelPending();
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onRejection);
      editor!.destroy();
      session.dispose();
      root.remove();
    },
  };
  return lab;
}
