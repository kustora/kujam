/**
 * Plugin lab runtime (BOARD-2412): turns user source into plugin definitions.
 *
 * Pipeline: {@link transpile} (sucrase strips TypeScript and turns ES imports into `require`
 * calls), {@link evaluateModule} (runs the code with `require` bound to an injected module map, so
 * `import { defineElement } from '@kujam/core'` gets the real package), {@link collectPlugins}
 * (finds the exported plugins, elements, tools, and brushes), and {@link instrumentPlugin} (wraps
 * user callbacks so their errors are reported instead of breaking the board).
 *
 * Evaluating code needs `eval`, which a strict Content Security Policy blocks (`docs/csp.md`):
 * this module is for development playgrounds only, never for the packages.
 */

import {
  definePlugin,
  rect,
  type AnyElementDefinition,
  type AnyPluginDefinition,
  type AnyToolDefinition,
  type ElementDefinition,
  type PluginBrushDefinition,
  type PluginToolbarItem,
} from '@kujam/core';
import { transform } from 'sucrase';

/** Where a lab issue comes from. */
export type LabIssueKind = 'compile' | 'evaluate' | 'install' | 'runtime' | 'render';

/** A problem found while compiling, installing, or running user code. */
export interface LabIssue {
  readonly kind: LabIssueKind;
  readonly message: string;
  /** What raised it, for example `tool example.stamp · idle.onPointerDown`. */
  readonly origin?: string;
  /** 1-based line in the user source, when known. */
  readonly line?: number;
  /** 0-based column in the user source, when known. */
  readonly column?: number;
  /** The original thrown value. */
  readonly cause?: unknown;
}

/** Thrown by the lab pipeline; carries the issue to show. */
export class LabError extends Error {
  readonly issue: LabIssue;
  constructor(issue: LabIssue) {
    super(issue.message);
    this.name = 'LabError';
    this.issue = issue;
  }
}

/** File name given to evaluated code, so stack traces point at the user source. */
export const LAB_SOURCE_URL = 'kujam-plugin-lab.ts';

/** ID of the plugin that bundles loose exported elements, tools, and brushes. */
export const LOOSE_PLUGIN_ID = 'lab.exports';

/** Message of any thrown value. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    const errors = (error as { errors?: unknown }).errors;
    let message = error.message || error.name;
    if (Array.isArray(errors) && errors.length > 0) message += ` (${errors.join('; ')})`;
    if (cause !== undefined && cause !== error) message += ` ← ${messageOf(cause)}`;
    return message;
  }
  return String(error);
}

/**
 * Line and column of the innermost stack frame in the user source, read from `error.stack`
 * (Chromium `at f (kujam-plugin-lab.ts:3:7)`, Firefox and WebKit `f@kujam-plugin-lab.ts:3:7`).
 */
export function locateInSource(error: unknown): { line: number; column: number } | undefined {
  const stack = error instanceof Error ? error.stack : undefined;
  if (!stack) return undefined;
  const escaped = LAB_SOURCE_URL.replace(/[.]/g, '\\.');
  const match = new RegExp(`${escaped}:(\\d+):(\\d+)`).exec(stack);
  if (!match) return undefined;
  // Stack columns are 1-based; editor columns are 0-based.
  return { line: Number(match[1]), column: Math.max(0, Number(match[2]) - 1) };
}

/** Builds an issue from a thrown value, with its source location when the stack has one. */
export function issueFrom(kind: LabIssueKind, error: unknown, origin?: string): LabIssue {
  if (error instanceof LabError) return error.issue;
  return { kind, message: messageOf(error), origin, cause: error, ...locateInSource(error) };
}

// ---------- Transpile ----------

/**
 * Transpiles TypeScript or JavaScript ES modules into CommonJS-style code for
 * {@link evaluateModule}. Line numbers are preserved, so runtime stack lines match the source.
 *
 * @throws {LabError} `compile` issue with the syntax error position.
 */
export function transpile(source: string): string {
  try {
    return transform(source, {
      transforms: ['typescript', 'imports'],
      filePath: LAB_SOURCE_URL,
      production: true,
    }).code;
  } catch (error) {
    const loc = (error as { loc?: { line: number; column: number } }).loc;
    throw new LabError({
      kind: 'compile',
      message: messageOf(error),
      cause: error,
      // Sucrase points one past the offending character.
      ...(loc ? { line: loc.line, column: Math.max(0, loc.column - 1) } : {}),
    });
  }
}

// ---------- Evaluate ----------

/** Module namespaces user code may import, keyed by specifier (for example `'@kujam/core'`). */
export type LabModules = Readonly<Record<string, unknown>>;

/**
 * Runs transpiled code and returns its exports. `require(specifier)` resolves only from
 * `modules`; any other import fails with a clear message.
 *
 * @throws {LabError} `evaluate` issue when the code throws at top level.
 */
export function evaluateModule(code: string, modules: LabModules): Record<string, unknown> {
  const require = (specifier: string): unknown => {
    if (Object.hasOwn(modules, specifier)) return modules[specifier];
    const known = Object.keys(modules).join(', ');
    throw new Error(
      `Modul "${specifier}" tidak tersedia di lab. Modul yang bisa diimpor: ${known}.`,
    );
  };
  const module = { exports: {} as Record<string, unknown> };
  // The wrapper opens on the first line, so line N of the code is line N of the evaluated source.
  const wrapped = `(function (require, module, exports) {${code}\n})\n//# sourceURL=${LAB_SOURCE_URL}`;
  try {
    // Indirect eval runs in global scope: user code cannot see this module's variables.
    const factory = (0, eval)(wrapped) as (
      req: typeof require,
      mod: typeof module,
      exp: Record<string, unknown>,
    ) => void;
    factory(require, module, module.exports);
  } catch (error) {
    throw new LabError(issueFrom('evaluate', error));
  }
  return module.exports;
}

// ---------- Collect ----------

type Classified =
  | { kind: 'plugin'; value: AnyPluginDefinition }
  | { kind: 'element'; value: AnyElementDefinition }
  | { kind: 'tool'; value: AnyToolDefinition }
  | { kind: 'brush'; value: PluginBrushDefinition };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Recognizes what `defineElement`, `defineTool`, `defineBrush`, and `definePlugin` return. */
function classify(value: unknown): Classified | null {
  if (!isObject(value)) return null;
  if (typeof value.type === 'string' && typeof value.version === 'number' && isObject(value.props))
    return { kind: 'element', value: value as unknown as AnyElementDefinition };
  if (typeof value.id !== 'string') return null;
  if (typeof value.initial === 'string' && isObject(value.states))
    return { kind: 'tool', value: value as unknown as AnyToolDefinition };
  if ('strokeOptions' in value || 'blend' in value)
    return { kind: 'brush', value: value as unknown as PluginBrushDefinition };
  return { kind: 'plugin', value: value as unknown as AnyPluginDefinition };
}

/**
 * Plugins to install from a module's exports: exported plugins as they are, plus one
 * {@link LOOSE_PLUGIN_ID} plugin for exported elements, tools, and brushes (with a toolbar item for
 * each loose tool). The default export comes first; arrays are flattened.
 *
 * @throws {LabError} `evaluate` issue when nothing usable is exported.
 */
export function collectPlugins(exports: Record<string, unknown>): AnyPluginDefinition[] {
  const values: unknown[] = [];
  const keys = Object.keys(exports).sort((a, b) =>
    a === 'default' ? -1 : b === 'default' ? 1 : 0,
  );
  for (const key of keys) {
    const value = exports[key];
    if (Array.isArray(value)) values.push(...value);
    else values.push(value);
  }

  const plugins: AnyPluginDefinition[] = [];
  const elements: AnyElementDefinition[] = [];
  const tools: AnyToolDefinition[] = [];
  const brushes: PluginBrushDefinition[] = [];
  const seen = new Set<unknown>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    const item = classify(value);
    if (item?.kind === 'plugin') plugins.push(item.value);
    else if (item?.kind === 'element') elements.push(item.value);
    else if (item?.kind === 'tool') tools.push(item.value);
    else if (item?.kind === 'brush') brushes.push(item.value);
  }
  // Loose definitions already bundled by an exported plugin are not installed twice.
  const bundled = new Set<unknown>(
    plugins.flatMap((p) => [...(p.elements ?? []), ...(p.tools ?? []), ...(p.brushes ?? [])]),
  );
  const loose = {
    elements: elements.filter((d) => !bundled.has(d)),
    tools: tools.filter((d) => !bundled.has(d)),
    brushes: brushes.filter((d) => !bundled.has(d)),
  };
  if (loose.elements.length + loose.tools.length + loose.brushes.length > 0) {
    const toolbarItems: PluginToolbarItem[] = loose.tools.map((tool, order) => ({
      id: `${LOOSE_PLUGIN_ID}.${tool.id}`,
      label: tool.id,
      toolId: tool.id,
      group: 'lab',
      order,
    }));
    try {
      plugins.push(definePlugin({ id: LOOSE_PLUGIN_ID, ...loose, toolbarItems }));
    } catch (error) {
      throw new LabError(issueFrom('install', error, 'definePlugin'));
    }
  }
  if (plugins.length === 0) {
    throw new LabError({
      kind: 'evaluate',
      message:
        'Kode tidak mengekspor plugin, elemen, tool, atau kuas. Gunakan `export default definePlugin({ ... })` atau ekspor hasil `defineElement`/`defineTool`/`defineBrush`.',
    });
  }
  return plugins;
}

// ---------- Instrument ----------

/** Receives issues raised while user callbacks run. */
export type LabReporter = (issue: LabIssue) => void;

/** Errors already reported by a wrapper, so global handlers do not report them twice. */
const reported = new WeakSet<object>();

/** Whether a wrapper already reported `error`. */
export function wasReported(error: unknown): boolean {
  return isObject(error) && reported.has(error);
}

function report(reporter: LabReporter, error: unknown, origin: string): void {
  if (isObject(error)) {
    if (reported.has(error)) return;
    reported.add(error);
  }
  reporter(issueFrom('runtime', error, origin));
}

/** Wraps `fn`: on throw, reports and returns `fallback()`. */
function guard<F extends (...args: never[]) => unknown>(
  fn: F,
  reporter: LabReporter,
  origin: string,
  fallback: (...args: Parameters<F>) => ReturnType<F>,
): F {
  return function (this: unknown, ...args: Parameters<F>) {
    try {
      return fn.apply(this, args);
    } catch (error) {
      report(reporter, error, origin);
      return fallback(...args);
    }
  } as F;
}

/** Wraps `fn`: on throw, reports and rethrows, so the caller (the tool runtime) can roll back. */
function observe<F extends (...args: never[]) => unknown>(
  fn: F,
  reporter: LabReporter,
  origin: string,
): F {
  return function (this: unknown, ...args: Parameters<F>) {
    try {
      return fn.apply(this, args);
    } catch (error) {
      report(reporter, error, origin);
      throw error;
    }
  } as F;
}

function instrumentElement(def: AnyElementDefinition, reporter: LabReporter): AnyElementDefinition {
  const at = (name: string) => `elemen ${def.type} · ${name}`;
  const next: Record<string, unknown> = { ...def };
  // Callbacks core runs synchronously outside the renderer's per-element isolation (BOARD-810):
  // a throw falls back to a safe value instead of breaking hit-testing or the toolbar.
  if (def.geometry)
    next.geometry = guard(def.geometry, reporter, at('geometry'), (el) => rect(el.w, el.h));
  if (def.actions) next.actions = guard(def.actions, reporter, at('actions'), () => []);
  if (def.a11y)
    next.a11y = guard(def.a11y, reporter, at('a11y'), () => ({ role: 'group', label: def.type }));
  if (def.placeholder)
    next.placeholder = guard(def.placeholder, reporter, at('placeholder'), () => ({ label: '' }));
  if (def.onDoubleClick)
    next.onDoubleClick = guard(def.onDoubleClick, reporter, at('onDoubleClick'), () => undefined);
  if (def.references) next.references = guard(def.references, reporter, at('references'), () => []);
  // `resolve` and `render` errors are already caught by core and the renderer and arrive as
  // `resolve-error` and `render-error` board events.
  return Object.freeze(next) as unknown as ElementDefinition;
}

function instrumentTool(def: AnyToolDefinition, reporter: LabReporter): AnyToolDefinition {
  const states: Record<string, Record<string, unknown>> = {};
  for (const [name, state] of Object.entries(def.states as Record<string, object>)) {
    const wrapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(state)) {
      wrapped[key] =
        typeof value === 'function'
          ? observe(value as () => unknown, reporter, `tool ${def.id} · ${name}.${key}`)
          : value;
    }
    states[name] = wrapped;
  }
  const next: Record<string, unknown> = { ...def, states };
  if (typeof def.data === 'function')
    next.data = observe(def.data, reporter, `tool ${def.id} · data`);
  return Object.freeze(next) as unknown as AnyToolDefinition;
}

/**
 * A copy of `plugin` whose user callbacks report their errors to `reporter`: element callbacks
 * fall back to safe values, tool handlers rethrow after reporting so the tool runtime cancels the
 * interaction. `setup` is left as is: a throw there fails `createBoard`, which the session reports
 * as an `install` issue.
 */
export function instrumentPlugin(
  plugin: AnyPluginDefinition,
  reporter: LabReporter,
): AnyPluginDefinition {
  const next: Record<string, unknown> = { ...plugin };
  if (plugin.elements) next.elements = plugin.elements.map((d) => instrumentElement(d, reporter));
  if (plugin.tools) next.tools = plugin.tools.map((d) => instrumentTool(d, reporter));
  return Object.freeze(next) as unknown as AnyPluginDefinition;
}

// ---------- All together ----------

/**
 * Compiles user source into instrumented plugins ready to install.
 *
 * @throws {LabError} With a `compile` or `evaluate` issue.
 */
export function compilePlugins(
  source: string,
  modules: LabModules,
  reporter: LabReporter,
): AnyPluginDefinition[] {
  const exports = evaluateModule(transpile(source), modules);
  return collectPlugins(exports).map((p) => instrumentPlugin(p, reporter));
}
