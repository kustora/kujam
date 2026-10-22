/**
 * Live plugin lab (BOARD-2412), reusable by the documentation playground (BOARD-2205):
 *
 * - {@link mountCodeEditor}: the CodeMirror editor alone;
 * - {@link mountPluginLab}: editor, live board, and issue panel together;
 * - {@link createPluginLabSession}: the DOM-free compile and re-install logic;
 * - {@link LAB_EXAMPLES}: ready-made snippets.
 */
export { mountCodeEditor } from './code-editor.js';
export type {
  CodeEditor,
  CodeEditorDiagnostic,
  CodeEditorLanguage,
  CodeEditorOptions,
} from './code-editor.js';
export { findExample, LAB_EXAMPLES, type LabExample } from './examples.js';
export {
  DEFAULT_LAB_MODULES,
  DEFAULT_LAB_PLUGINS,
  mountPluginLab,
  type PluginLab,
  type PluginLabOptions,
} from './lab.js';
export {
  compilePlugins,
  LabError,
  LOOSE_PLUGIN_ID,
  type LabIssue,
  type LabIssueKind,
  type LabModules,
} from './runtime.js';
export {
  createPluginLabSession,
  type ApplyResult,
  type PluginLabSession,
  type PluginLabSessionOptions,
} from './session.js';
