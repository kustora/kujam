/**
 * Tools as state machines (BOARD-501, ADR-004).
 *
 * The renderer translates DOM events into normalized {@link BoardInputEvent}s and then calls
 * `board.dispatch`. Tools never touch the DOM, so their behavior is the same in every framework
 * and can be tested in Node with sequences of synthetic events.
 *
 * Runtime rules:
 * - One active tool holds one primary pointer. The pointer that makes the tool leave its initial
 *   state becomes the primary pointer until the tool returns to the initial state; other pointer events are ignored
 *   (the renderer routes them to the gesture recognizer).
 * - Document changes via `ctx.change` form one interaction: returning to the initial state
 *   commits it as a single undo step, while `cancel` rolls it back.
 * - A `cancel` transition exists in every state without being written: triggered by the primary pointer's
 *   `pointer-cancel`, Esc, `ctx.cancel()`, switching tools, undo, or a throwing handler.
 * - Esc while the tool is in its initial state returns to the default tool. A `oneShot` tool returns to the default tool
 *   after one interaction finishes.
 * - Holding Space temporarily activates the `hand` tool (when registered), then switches back on release.
 */

import type { Point } from '../geometry/geometry.js';
import type { Board } from '../index.js';
import type { Interaction } from './interaction.js';
import type { Transaction } from '../document/store.js';

// ---------- Normalized input events ----------

/**
 * Pointer kind, same as `PointerEvent.pointerType`.
 *
 * @beta
 */
export type PointerKind = 'mouse' | 'pen' | 'touch';

/**
 * Modifier key state when the event occurred.
 *
 * @beta
 */
export interface InputModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
}

/**
 * Pointer event from the renderer (Pointer Events for mouse, touch, and pen).
 *
 * @beta
 */
export interface ToolPointerEvent {
  readonly type: 'pointer-down' | 'pointer-move' | 'pointer-up' | 'pointer-cancel';
  readonly pointerId: number;
  readonly pointerType: PointerKind;
  /** Position in board coordinates. */
  readonly point: Point;
  /** Position in CSS pixels relative to the board container. */
  readonly screen: Point;
  /** Pressure 0–1. Mouse sends 0.5 while a button is pressed and 0 otherwise. */
  readonly pressure: number;
  /** Pen tilt in degrees (−90 to 90); 0 for mouse and touch. */
  readonly tiltX: number;
  readonly tiltY: number;
  /** Button that changed (`PointerEvent.button`): 0 primary, 1 middle, 2 secondary, 5 eraser. */
  readonly button: number;
  /** Bitmask of pressed buttons (`PointerEvent.buttons`); 32 = stylus eraser. */
  readonly buttons: number;
  readonly modifiers: InputModifiers;
  /**
   * Consecutive click count on `pointer-down` (`PointerEvent.detail`): 2 for the second press of a
   * double click. Optional; treated as 1 when missing (BOARD-502).
   */
  readonly clickCount?: number;
}

/**
 * Keyboard event from the renderer. The renderer does not send it while focus is in a text input.
 *
 * @beta
 */
export interface ToolKeyEvent {
  readonly type: 'key-down' | 'key-up';
  /** `KeyboardEvent.key`, for example `'Escape'` or `'a'`. */
  readonly key: string;
  /** `KeyboardEvent.code`, for example `'Space'` or `'KeyA'`. */
  readonly code: string;
  readonly repeat: boolean;
  readonly modifiers: InputModifiers;
  /**
   * Focus is in a text input outside the board, or text on the board is being edited (BOARD-504).
   * The board then ignores the event except Escape: no shortcut runs and the tool does not get it.
   */
  readonly inTextInput?: boolean;
}

/**
 * Mouse wheel or trackpad scroll event, with deltas in CSS pixels.
 *
 * @beta
 */
export interface ToolWheelEvent {
  readonly type: 'wheel';
  readonly point: Point;
  readonly screen: Point;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly modifiers: InputModifiers;
}

/**
 * Two-finger or trackpad pinch gesture already recognized by the renderer.
 *
 * @beta
 */
export interface ToolPinchEvent {
  readonly type: 'pinch';
  readonly phase: 'start' | 'update' | 'end';
  /** Gesture center point in board coordinates. */
  readonly point: Point;
  /** Gesture center point in CSS pixels. */
  readonly screen: Point;
  /** Scale factor relative to the previous event (1 = unchanged). */
  readonly scale: number;
  /** Center point shift since the previous event, in CSS pixels. */
  readonly deltaX: number;
  readonly deltaY: number;
}

/**
 * All input events accepted by `board.dispatch`.
 *
 * @beta
 */
export type BoardInputEvent = ToolPointerEvent | ToolKeyEvent | ToolWheelEvent | ToolPinchEvent;

// ---------- Tool definition ----------

/**
 * Context received by every tool state handler.
 *
 * @beta
 */
export interface ToolContext<S extends string = string, D = Record<string, unknown>> {
  readonly board: Board;
  /** Current state. */
  readonly state: S;
  /** Tool-owned data on this board; recreated every time the tool enters its initial state. */
  data: D;
  /**
   * Applies a document change as part of the ongoing interaction. The change is
   * visible immediately, then committed as a single undo step when the tool returns to its initial state
   * (or on `commit`), or rolled back on `cancel`. The last label is used for the undo
   * step; defaults to the tool ID.
   */
  change(fn: (tx: Transaction) => void, options?: { label?: string }): void;
  /** Commits the interaction now without changing state. */
  commit(): void;
  /**
   * Rolls back the interaction and returns to the initial state. The return value of the calling handler
   * is ignored.
   */
  cancel(): void;
}

/**
 * Handlers for one state. Event handlers may return the next state name; with no return
 * value, the tool stays in the same state.
 *
 * @beta
 */
export interface ToolStateDefinition<S extends string = string, D = Record<string, unknown>> {
  /** CSS cursor while this state is active; overrides the tool's `cursor`. */
  readonly cursor?: string;
  readonly onEnter?: (ctx: ToolContext<S, D>) => S | void;
  readonly onExit?: (ctx: ToolContext<S, D>) => void;
  /** Called after the interaction is rolled back, before `onExit` and returning to the initial state. */
  readonly onCancel?: (ctx: ToolContext<S, D>) => void;
  readonly onPointerDown?: (ctx: ToolContext<S, D>, event: ToolPointerEvent) => S | void;
  readonly onPointerMove?: (ctx: ToolContext<S, D>, event: ToolPointerEvent) => S | void;
  readonly onPointerUp?: (ctx: ToolContext<S, D>, event: ToolPointerEvent) => S | void;
  readonly onKeyDown?: (ctx: ToolContext<S, D>, event: ToolKeyEvent) => S | void;
  readonly onKeyUp?: (ctx: ToolContext<S, D>, event: ToolKeyEvent) => S | void;
  readonly onWheel?: (ctx: ToolContext<S, D>, event: ToolWheelEvent) => S | void;
  readonly onPinch?: (ctx: ToolContext<S, D>, event: ToolPinchEvent) => S | void;
}

/**
 * Tool definition.
 *
 * @typeParam S - State names, inferred from the `states` keys.
 * @typeParam D - Type of `ctx.data`, inferred from `data`.
 *
 * @beta
 */
export interface ToolDefinition<S extends string = string, D = Record<string, unknown>> {
  /** Tool ID: lowercase letters, digits, dots, or hyphens, for example `'pen'` or `'example.stamp'`. */
  readonly id: string;
  /** Default CSS cursor of the tool. Defaults to `'default'`. */
  readonly cursor?: string;
  /** Return to the default tool after one interaction finishes. */
  readonly oneShot?: boolean;
  /** Initial (idle) state. Returning to this state commits the interaction. */
  readonly initial: NoInfer<S>;
  /** State names are inferred only from this object's keys, not from handler return values. */
  readonly states: { readonly [K in S]: ToolStateDefinition<NoInfer<S>, D> };
  /** Factory for `ctx.data`. Defaults to `() => ({})`. */
  readonly data?: () => D;
}

/**
 * Tool definition with any states and data, for mixed collections.
 *
 * @beta
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any>;

/**
 * Codes for {@link ToolError}.
 *
 * - `invalid-tool`: the tool definition is invalid.
 * - `duplicate-tool`: the tool ID is already registered.
 * - `unknown-tool`: `setTool` was called with an unregistered ID.
 * - `unknown-state`: a handler returned a state name that does not exist.
 *
 * @beta
 */
export type ToolErrorCode = 'invalid-tool' | 'duplicate-tool' | 'unknown-tool' | 'unknown-state';

/**
 * Tool registry and runtime error.
 *
 * @beta
 */
export class ToolError extends Error {
  readonly code: ToolErrorCode;
  /** The offending tool ID, or `undefined` when `id` itself is invalid. */
  readonly toolId: string | undefined;
  /** Definition problems; empty except for `invalid-tool`. */
  readonly errors: readonly string[];

  constructor(
    code: ToolErrorCode,
    message: string,
    toolId: string | undefined,
    errors: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.toolId = toolId;
    this.errors = errors;
  }
}

const TOOL_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const STATE_HANDLERS = [
  'onEnter',
  'onExit',
  'onCancel',
  'onPointerDown',
  'onPointerMove',
  'onPointerUp',
  'onKeyDown',
  'onKeyUp',
  'onWheel',
  'onPinch',
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectToolErrors(definition: unknown): string[] {
  if (!isPlainObject(definition)) return ['Definisi tool wajib berupa objek.'];
  const errors: string[] = [];
  if (typeof definition.id !== 'string' || !TOOL_ID.test(definition.id)) {
    errors.push('id wajib huruf kecil, angka, titik, atau tanda hubung (misalnya "pen").');
  }
  if (definition.cursor !== undefined && typeof definition.cursor !== 'string') {
    errors.push('cursor wajib berupa string.');
  }
  if (definition.oneShot !== undefined && typeof definition.oneShot !== 'boolean') {
    errors.push('oneShot wajib berupa boolean.');
  }
  if (definition.data !== undefined && typeof definition.data !== 'function') {
    errors.push('data wajib berupa fungsi.');
  }
  const { states } = definition;
  if (!isPlainObject(states) || Object.keys(states).length === 0) {
    errors.push('states wajib berupa objek dengan minimal satu state.');
    return errors;
  }
  if (typeof definition.initial !== 'string' || !Object.hasOwn(states, definition.initial)) {
    errors.push('initial wajib nama salah satu state.');
  }
  for (const [name, state] of Object.entries(states)) {
    if (!isPlainObject(state)) {
      errors.push(`states.${name} wajib berupa objek.`);
      continue;
    }
    if (state.cursor !== undefined && typeof state.cursor !== 'string') {
      errors.push(`states.${name}.cursor wajib berupa string.`);
    }
    for (const key of STATE_HANDLERS) {
      if (state[key] !== undefined && typeof state[key] !== 'function') {
        errors.push(`states.${name}.${key} wajib berupa fungsi.`);
      }
    }
  }
  return errors;
}

function assertValidTool(definition: unknown): void {
  const errors = collectToolErrors(definition);
  if (errors.length === 0) return;
  const id = isPlainObject(definition) ? definition.id : undefined;
  const toolId = typeof id === 'string' && id ? id : undefined;
  throw new ToolError(
    'invalid-tool',
    `Definisi tool${toolId ? ` "${toolId}"` : ''} tidak valid: ${errors.join(' ')}`,
    toolId,
    errors,
  );
}

/**
 * Defines a tool as a state machine. State names are inferred from `states`, so
 * handlers may only return existing states. The definition is validated immediately (see
 * {@link ToolError}) and the object is shallow-frozen.
 *
 * @example
 * ```ts
 * const stamp = defineTool({
 *   id: 'example.stamp',
 *   cursor: 'crosshair',
 *   initial: 'idle',
 *   data: () => ({ id: '' }),
 *   states: {
 *     idle: {
 *       onPointerDown(ctx, e) {
 *         ctx.data.id = ctx.board.createId();
 *         ctx.change((tx) => tx.put(makeStamp(ctx.data.id, e.point)));
 *         return 'dragging';
 *       },
 *     },
 *     dragging: {
 *       onPointerMove: (ctx, e) => ctx.change((tx) => moveStamp(tx, ctx.data.id, e.point)),
 *       onPointerUp: () => 'idle', // commit as a single undo step
 *     },
 *   },
 * });
 * ```
 *
 * @beta
 */
export function defineTool<S extends string, D = Record<string, unknown>>(
  definition: ToolDefinition<S, D>,
): ToolDefinition<S, D> {
  assertValidTool(definition);
  return Object.freeze({ ...definition });
}

// ---------- Registry and runtime ----------

/**
 * Name of the tool activated temporarily while Space is held.
 *
 * @beta
 */
export const HAND_TOOL_ID = 'hand';

/**
 * Default tool when `createBoard({ defaultTool })` is not set.
 *
 * @beta
 */
export const DEFAULT_TOOL_ID = 'select';

/**
 * Tool registry owned by one board (`board.tools`).
 *
 * @beta
 */
export interface BoardTools {
  /**
   * Registers a tool and returns a function that unregisters it. Unregistering the active tool
   * cancels its interaction and switches to the default tool (or no tool). Throws
   * {@link ToolError} with code `duplicate-tool` or `invalid-tool`.
   *
   * @beta Plugins will register tools via `definePlugin` (BOARD-602).
   */
  register(definition: AnyToolDefinition): () => void;
  get(id: string): AnyToolDefinition | undefined;
  has(id: string): boolean;
  /** All tools in registration order. */
  list(): readonly AnyToolDefinition[];
}

/** @internal */
export interface ToolRuntimeOptions {
  getBoard: () => Board;
  interaction: Interaction;
  defaultTool: string;
  onToolChange: (id: string | null, previous: string | null) => void;
}

/** @internal */
export interface ToolRuntime {
  readonly api: BoardTools;
  readonly tool: string | null;
  readonly state: string | null;
  readonly cursor: string;
  /** `ctx.data` of the active tool, or `undefined` when no tool is active. */
  readonly data: unknown;
  /** Whether the tool is outside its initial state (an interaction is in progress). */
  readonly busy: boolean;
  setTool(id: string): void;
  dispatch(event: BoardInputEvent): boolean;
  /** Cancels the ongoing interaction. Returns `true` when the tool was busy. */
  cancel(): boolean;
  /** Returns to the initial state without rollback, after the document is replaced. */
  reset(): void;
  clear(): void;
}

type Handler = (ctx: ToolContext, event?: BoardInputEvent) => string | void;

const HANDLER_FOR: Record<BoardInputEvent['type'], keyof ToolStateDefinition | null> = {
  'pointer-down': 'onPointerDown',
  'pointer-move': 'onPointerMove',
  'pointer-up': 'onPointerUp',
  'pointer-cancel': null,
  'key-down': 'onKeyDown',
  'key-up': 'onKeyUp',
  wheel: 'onWheel',
  pinch: 'onPinch',
};

/** Limit on chained `onEnter` calls returning another state, to prevent infinite loops. */
const MAX_CHAINED_TRANSITIONS = 32;

/** @internal */
export function createToolRuntime(options: ToolRuntimeOptions): ToolRuntime {
  const { getBoard, interaction, defaultTool, onToolChange } = options;
  const byId = new Map<string, AnyToolDefinition>();

  interface Active {
    readonly definition: AnyToolDefinition;
    state: string;
    data: unknown;
    pointerId: number | null;
    /** Incremented on every state change, to ignore stale handler return values. */
    generation: number;
    readonly ctx: ToolContext;
  }

  let active: Active | null = null;
  /** Tool restored when Space is released, or `null` when the hand tool is not temporary. */
  let springFrom: string | null = null;

  function makeData(definition: AnyToolDefinition): unknown {
    return definition.data ? definition.data() : {};
  }

  function stateDef(a: Active, state = a.state): ToolStateDefinition {
    return a.definition.states[state] as ToolStateDefinition;
  }

  function call<K extends keyof ToolStateDefinition>(
    a: Active,
    key: K,
    event?: BoardInputEvent,
  ): string | void {
    const handler = stateDef(a)[key] as Handler | undefined;
    return handler?.(a.ctx, event);
  }

  function activate(definition: AnyToolDefinition): Active {
    const a: Active = {
      definition,
      state: definition.initial,
      data: makeData(definition),
      pointerId: null,
      generation: 0,
      ctx: {
        get board() {
          return getBoard();
        },
        get state() {
          return a.state;
        },
        get data() {
          return a.data;
        },
        set data(value) {
          a.data = value;
        },
        change(fn, changeOptions) {
          if (active !== a) throw new Error(`Tool "${definition.id}" sudah tidak aktif.`);
          interaction.change(fn, changeOptions?.label);
        },
        commit() {
          if (active === a) interaction.commit(definition.id);
        },
        cancel() {
          if (active === a) cancelActive();
        },
      } as ToolContext,
    };
    return a;
  }

  /** Enters the initial state: commit the interaction, release the pointer, recreate data. */
  function settle(a: Active): void {
    interaction.commit(a.definition.id);
    a.pointerId = null;
    a.data = makeData(a.definition);
  }

  function transition(a: Active, next: string | void, depth = 0): void {
    if (next === undefined || next === a.state || active !== a) return;
    if (!Object.hasOwn(a.definition.states, next)) {
      throw new ToolError(
        'unknown-state',
        `Tool "${a.definition.id}" tidak punya state "${next}".`,
        a.definition.id,
      );
    }
    if (depth >= MAX_CHAINED_TRANSITIONS) {
      throw new Error(`Tool "${a.definition.id}" berpindah state terus-menerus lewat onEnter.`);
    }
    call(a, 'onExit');
    const completed = next === a.definition.initial;
    a.state = next;
    a.generation++;
    if (completed) settle(a);
    const gen = a.generation;
    const chained = call(a, 'onEnter');
    if (active === a && gen === a.generation) transition(a, chained, depth + 1);
    if (completed && active === a && a.definition.oneShot && a.state === a.definition.initial) {
      switchTo(defaultTool);
    }
  }

  /** Rolls back the active tool's interaction, then returns to the initial state. */
  function cancelActive(): boolean {
    const a = active;
    if (!a) return false;
    const busy = a.state !== a.definition.initial || interaction.active;
    if (!busy) return false;
    a.generation++;
    try {
      interaction.rollback();
      if (active === a) call(a, 'onCancel');
      if (active === a && a.state !== a.definition.initial) {
        call(a, 'onExit');
        a.state = a.definition.initial;
        a.generation++;
        settle(a);
        call(a, 'onEnter');
      }
    } finally {
      // Whatever happens in the handler, the interaction must not be left open.
      if (interaction.active) interaction.discard();
      if (active === a) {
        a.state = a.definition.initial;
        a.pointerId = null;
      }
    }
    return true;
  }

  /** Runs a handler; if it throws, the interaction is rolled back and the error is rethrown. */
  function guarded(a: Active, run: () => void): void {
    try {
      run();
    } catch (error) {
      try {
        if (active === a) cancelActive();
      } catch {
        // The original error matters more than errors while cancelling.
      }
      throw error;
    }
  }

  function switchTo(id: string | null): void {
    const previous = active?.definition.id ?? null;
    if (id === previous) return;
    const next = id === null ? undefined : byId.get(id);
    if (id !== null && !next) {
      throw new ToolError('unknown-tool', `Tool "${id}" tidak terdaftar.`, id);
    }
    const current = active;
    if (current) {
      cancelActive();
      if (active === current) {
        active = null;
        call(current, 'onExit');
      }
    }
    if (next) {
      const a = activate(next);
      active = a;
      guarded(a, () => transition(a, call(a, 'onEnter')));
    } else {
      active = null;
    }
    onToolChange(active?.definition.id ?? null, previous);
  }

  function handleSpace(event: ToolKeyEvent): boolean | undefined {
    if (event.code !== 'Space') return undefined;
    if (event.type === 'key-down') {
      if (springFrom !== null) return true;
      if (event.repeat || !byId.has(HAND_TOOL_ID) || !active) return undefined;
      if (active.definition.id === HAND_TOOL_ID || active.state !== active.definition.initial) {
        return undefined;
      }
      const from = active.definition.id;
      switchTo(HAND_TOOL_ID);
      springFrom = from;
      return true;
    }
    if (springFrom === null) return undefined;
    const back = springFrom;
    springFrom = null;
    switchTo(byId.has(back) ? back : null);
    return true;
  }

  function handleEscape(event: ToolKeyEvent): boolean {
    if (event.type !== 'key-down' || event.key !== 'Escape' || !active) return false;
    if (cancelActive()) return true;
    if (active.definition.id !== defaultTool && byId.has(defaultTool)) {
      springFrom = null;
      switchTo(defaultTool);
      return true;
    }
    return false;
  }

  function dispatchPointer(a: Active, event: ToolPointerEvent): boolean {
    if (a.pointerId !== null && event.pointerId !== a.pointerId) return false;
    if (event.type === 'pointer-cancel') {
      return a.pointerId !== null ? cancelActive() : false;
    }
    return deliver(a, event);
  }

  function deliver(a: Active, event: BoardInputEvent): boolean {
    const key = HANDLER_FOR[event.type];
    if (!key || !stateDef(a)[key]) return false;
    const wasIdle = a.state === a.definition.initial;
    guarded(a, () => {
      const gen = a.generation;
      const next = call(a, key, event);
      if (active === a && gen === a.generation) transition(a, next);
      // Changes in the initial state (for example a single click to place an element) are committed immediately.
      if (active === a && a.state === a.definition.initial) interaction.commit(a.definition.id);
    });
    if (
      wasIdle &&
      active === a &&
      a.state !== a.definition.initial &&
      event.type === 'pointer-down'
    ) {
      a.pointerId = event.pointerId;
    }
    return true;
  }

  const api: BoardTools = {
    register(definition) {
      assertValidTool(definition);
      const { id } = definition;
      if (byId.has(id)) {
        throw new ToolError(
          'duplicate-tool',
          `Tool "${id}" sudah terdaftar. Setiap ID hanya boleh didaftarkan sekali; pakai ID lain ` +
            'atau pastikan plugin yang sama tidak dipasang dua kali.',
          id,
        );
      }
      const frozen = Object.isFrozen(definition) ? definition : Object.freeze({ ...definition });
      byId.set(id, frozen);
      return () => {
        if (byId.get(id) !== frozen) return;
        byId.delete(id);
        if (springFrom === id) springFrom = null;
        if (active?.definition === frozen) {
          springFrom = null;
          switchTo(byId.has(defaultTool) ? defaultTool : null);
        }
      };
    },
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    list: () => Object.freeze([...byId.values()]),
  };

  return {
    api,
    get tool() {
      return active?.definition.id ?? null;
    },
    get state() {
      return active?.state ?? null;
    },
    get cursor() {
      if (!active) return 'default';
      return stateDef(active).cursor ?? active.definition.cursor ?? 'default';
    },
    get data() {
      return active?.data;
    },
    get busy() {
      return active !== null && (active.state !== active.definition.initial || interaction.active);
    },
    setTool(id) {
      if (typeof id !== 'string') throw new TypeError('ID tool wajib berupa string.');
      springFrom = null;
      switchTo(id);
    },
    dispatch(event) {
      if (!active || !event || !(event.type in HANDLER_FOR)) return false;
      if (event.type === 'key-down' || event.type === 'key-up') {
        if (handleEscape(event)) return true;
        const spring = handleSpace(event);
        if (spring !== undefined) return spring;
        return active ? deliver(active, event) : false;
      }
      if (
        event.type === 'pointer-down' ||
        event.type === 'pointer-move' ||
        event.type === 'pointer-up' ||
        event.type === 'pointer-cancel'
      ) {
        return dispatchPointer(active, event);
      }
      return deliver(active, event);
    },
    cancel: cancelActive,
    reset() {
      interaction.discard();
      if (!active || active.state === active.definition.initial) return;
      const a = active;
      a.generation++;
      a.state = a.definition.initial;
      a.pointerId = null;
      a.data = makeData(a.definition);
    },
    clear() {
      interaction.discard();
      active = null;
      springFrom = null;
      byId.clear();
    },
  };
}
