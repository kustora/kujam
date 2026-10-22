/**
 * Reusable code editor (BOARD-2412), built on CodeMirror 6 (MIT).
 *
 * Self-contained: it depends on nothing from the playground shell, so the documentation
 * playground (BOARD-2205) can mount the same component.
 *
 * @example
 * ```ts
 * const editor = mountCodeEditor(host, {
 *   value: 'export default definePlugin({ id: "demo" });',
 *   language: 'typescript',
 *   onChange: (code) => console.log(code.length),
 *   onRun: (code) => apply(code), // Mod-Enter
 * });
 * editor.setDiagnostics([{ line: 1, column: 0, message: 'Oops' }]);
 * editor.destroy();
 * ```
 */

import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';

/** Source language of the editor; both get syntax highlighting, `typescript` also parses types. */
export type CodeEditorLanguage = 'typescript' | 'javascript';

/** A problem to underline in the editor. `line` is 1-based, `column` is 0-based. */
export interface CodeEditorDiagnostic {
  readonly line: number;
  readonly column?: number;
  readonly message: string;
  /** Defaults to `'error'`. */
  readonly severity?: 'error' | 'warning' | 'info';
}

export interface CodeEditorOptions {
  /** Initial content. */
  readonly value?: string;
  /** Defaults to `'typescript'`. */
  readonly language?: CodeEditorLanguage;
  /** Called after every user edit with the full content. */
  readonly onChange?: (value: string) => void;
  /** Called on Mod-Enter (Ctrl-Enter or Cmd-Enter) with the full content. */
  readonly onRun?: (value: string) => void;
  /** Defaults to `'dark'`. */
  readonly theme?: 'dark' | 'light';
  readonly readOnly?: boolean;
  /** Accessible name of the editable area. Defaults to `'Code editor'`. */
  readonly ariaLabel?: string;
  /** Extra CodeMirror extensions, appended after the defaults. */
  readonly extensions?: readonly Extension[];
}

export interface CodeEditor {
  /** Current content. */
  getValue(): string;
  /** Replaces the whole content. Does not call `onChange`. */
  setValue(value: string): void;
  /** Underlines the given problems; an empty list clears them. */
  setDiagnostics(diagnostics: readonly CodeEditorDiagnostic[]): void;
  setReadOnly(readOnly: boolean): void;
  focus(): void;
  /** Removes the editor from the DOM. Further calls are no-ops. */
  destroy(): void;
  /** The underlying CodeMirror view, for advanced integrations. */
  readonly view: EditorView;
}

/** Converts a 1-based line and 0-based column into a document offset, clamped to the document. */
function offsetOf(state: EditorState, line: number, column = 0): number {
  const lineNo = Math.min(Math.max(1, Math.floor(line)), state.doc.lines);
  const info = state.doc.line(lineNo);
  return Math.min(info.from + Math.max(0, Math.floor(column)), info.to);
}

/** Mounts a code editor into `parent` and returns its controller. */
export function mountCodeEditor(parent: HTMLElement, options: CodeEditorOptions = {}): CodeEditor {
  const readOnly = new Compartment();
  let silent = false;
  let destroyed = false;

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.value ?? '',
      extensions: [
        basicSetup,
        keymap.of([
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: (v) => {
              options.onRun?.(v.state.doc.toString());
              return options.onRun !== undefined;
            },
          },
          indentWithTab,
        ]),
        javascript({ typescript: (options.language ?? 'typescript') === 'typescript' }),
        options.theme === 'light' ? [] : oneDark,
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
        }),
        EditorView.contentAttributes.of({ 'aria-label': options.ariaLabel ?? 'Code editor' }),
        readOnly.of(EditorState.readOnly.of(options.readOnly ?? false)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !silent) options.onChange?.(update.state.doc.toString());
        }),
        ...(options.extensions ?? []),
      ],
    }),
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setValue(value) {
      if (destroyed) return;
      silent = true;
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      } finally {
        silent = false;
      }
    },
    setDiagnostics(diagnostics) {
      if (destroyed) return;
      const list: Diagnostic[] = diagnostics.map((d) => {
        const from = offsetOf(view.state, d.line, d.column);
        const lineEnd = view.state.doc.lineAt(from).to;
        // Without a column the whole line is marked; with one, a single character.
        const to = d.column === undefined ? lineEnd : Math.min(from + 1, lineEnd);
        return {
          from,
          to: Math.max(to, from),
          severity: d.severity ?? 'error',
          message: d.message,
        };
      });
      view.dispatch(setDiagnostics(view.state, list));
    },
    setReadOnly(value) {
      if (destroyed) return;
      view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(value)) });
    },
    focus: () => view.focus(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      view.destroy();
    },
  };
}
