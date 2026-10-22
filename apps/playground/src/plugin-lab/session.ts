/**
 * Plugin lab session (BOARD-2412): installs user plugins on a live board and re-installs them on
 * every change, without reloading the page.
 *
 * Plugins are installed once per board (BOARD-602) and element types cannot be unregistered, so
 * a re-install builds a new board from the current document with the new plugin list, carries the
 * camera, selection, tool, and tool styles over, swaps the view, and disposes the old board (which
 * runs the old plugins' teardowns). Elements whose type disappeared stay in the document as
 * unknown types. When anything fails before the swap, the previous board keeps running untouched.
 *
 * The session knows nothing about the DOM: `mount` attaches whatever view the host wants.
 */

import {
  createBoard,
  type AnyPluginDefinition,
  type Board,
  type BoardDocument,
  type BoardErrorEvent,
  type CreateBoardOptions,
} from '@kujam/core';
import {
  compilePlugins,
  issueFrom,
  LabError,
  locateInSource,
  type LabIssue,
  type LabIssueKind,
  type LabModules,
} from './runtime.js';

export interface PluginLabSessionOptions {
  /** Plugins installed before the user's (for example `defaultElements` and `defaultTools`). */
  readonly basePlugins: readonly AnyPluginDefinition[];
  /** Modules user code may import, keyed by specifier. */
  readonly modules: LabModules;
  /** Extra `createBoard` options for every board of the session. */
  readonly boardOptions?: Omit<CreateBoardOptions, 'plugins' | 'document'>;
  /** Document of the first board. */
  readonly document?: BoardDocument;
  /** Fills the first board, for example with sample elements. */
  readonly seed?: (board: Board) => void;
  /** Attaches a view (renderer, UI) to a board; returns the function that detaches it. */
  readonly mount?: (board: Board) => () => void;
  /** Receives every issue: compile, install, and runtime errors, and board `error` events. */
  readonly onIssue?: (issue: LabIssue) => void;
  /** Called after the session switched to a new board (the previous one is already disposed). */
  readonly onBoard?: (board: Board) => void;
}

export interface ApplyResult {
  /** Whether the new code is now installed. */
  readonly ok: boolean;
  /** Compile and install issues of this attempt (runtime issues arrive later via `onIssue`). */
  readonly issues: readonly LabIssue[];
}

export interface PluginLabSession {
  /** The board currently shown. Changes after each successful {@link PluginLabSession.apply}. */
  readonly board: Board;
  /** User plugins installed on {@link PluginLabSession.board}, instrumented. */
  readonly userPlugins: readonly AnyPluginDefinition[];
  /** Compiles `source` and re-installs its plugins. Never throws. */
  apply(source: string): ApplyResult;
  /** Removes the user plugins, keeping the document. */
  reset(): ApplyResult;
  /** Reports an issue from outside the session, for example an uncaught error. */
  report(issue: LabIssue): void;
  /** Detaches the view and disposes the board. Idempotent. */
  dispose(): void;
}

const ERROR_KIND: Partial<Record<BoardErrorEvent['code'], LabIssueKind>> = {
  'render-error': 'render',
};

/** Starts a session with only the base plugins installed. */
export function createPluginLabSession(options: PluginLabSessionOptions): PluginLabSession {
  const emit = (issue: LabIssue): void => {
    try {
      options.onIssue?.(issue);
    } catch (error) {
      // A broken issue listener must not break the lab.
      console.error('[plugin-lab] onIssue', error);
    }
  };

  let disposed = false;
  let userPlugins: readonly AnyPluginDefinition[] = [];

  /** Creates a board with the base plugins plus `plugins`, listening for its `error` events. */
  function build(plugins: readonly AnyPluginDefinition[], document?: BoardDocument): Board {
    const next = createBoard({
      ...options.boardOptions,
      plugins: [...options.basePlugins, ...plugins],
      document,
    });
    next.on('error', (e) =>
      emit({
        kind: ERROR_KIND[e.code] ?? 'runtime',
        message: e.message,
        origin: e.code,
        cause: e.cause,
        ...locateInSource(e.cause),
      }),
    );
    return next;
  }

  let board = build([], options.document);
  options.seed?.(board);
  let unmount = options.mount?.(board) ?? (() => {});

  function safeUnmount(): void {
    try {
      unmount();
    } catch (error) {
      emit(issueFrom('runtime', error, 'unmount'));
    }
    unmount = () => {};
  }

  /** Carries view state from `from` to `to`. Best effort: a failure here is not an error. */
  function carryOver(from: Board, to: Board): void {
    try {
      to.setCamera(from.getCamera());
    } catch {
      // Keep the default camera.
    }
    for (const tool of to.tools.list()) {
      try {
        if (from.tools.has(tool.id)) to.toolStyles.set(tool.id, from.toolStyles.get(tool.id));
      } catch {
        // The new tool may not accept the old style.
      }
    }
    try {
      to.select(from.selection.filter((id) => to.getElement(id)));
    } catch {
      // Keep an empty selection.
    }
    try {
      if (from.tool && to.tools.has(from.tool)) to.setTool(from.tool);
    } catch {
      // Keep the default tool.
    }
  }

  function install(plugins: readonly AnyPluginDefinition[]): ApplyResult {
    if (disposed) return { ok: false, issues: [] };
    let next: Board;
    try {
      next = build(plugins, board.getDocument() as BoardDocument);
    } catch (error) {
      const issue = issueFrom('install', error, 'createBoard');
      emit(issue);
      return { ok: false, issues: [issue] };
    }
    carryOver(board, next);

    const previous = board;
    safeUnmount();
    try {
      unmount = options.mount?.(next) ?? (() => {});
    } catch (error) {
      const issue = issueFrom('install', error, 'mount');
      emit(issue);
      next.dispose();
      try {
        unmount = options.mount?.(previous) ?? (() => {});
      } catch (again) {
        unmount = () => {};
        emit(issueFrom('install', again, 'mount'));
      }
      return { ok: false, issues: [issue] };
    }
    board = next;
    userPlugins = plugins;
    try {
      previous.dispose();
    } catch (error) {
      emit(issueFrom('runtime', error, 'dispose'));
    }
    try {
      options.onBoard?.(next);
    } catch (error) {
      console.error('[plugin-lab] onBoard', error);
    }
    return { ok: true, issues: [] };
  }

  return {
    get board() {
      return board;
    },
    get userPlugins() {
      return userPlugins;
    },
    apply(source) {
      let plugins: AnyPluginDefinition[];
      try {
        plugins = compilePlugins(source, options.modules, emit);
      } catch (error) {
        const issue = error instanceof LabError ? error.issue : issueFrom('evaluate', error);
        emit(issue);
        return { ok: false, issues: [issue] };
      }
      return install(plugins);
    },
    reset: () => install([]),
    report: emit,
    dispose() {
      if (disposed) return;
      disposed = true;
      safeUnmount();
      board.dispose();
    },
  };
}
