/**
 * Input event pipeline for Pointer Events, multi-touch gestures, wheel, and keyboard (BOARD-806,
 * ADR-004), with the touch and stylus polish of BOARD-911: palm rejection, the "pen draws, fingers
 * pan" mode, two- and three-finger taps, predicted pen points, pen hover, the long-press selection
 * box, and pan inertia.
 */

import {
  createContextMenuEvent,
  type Board,
  type BoardInputEvent,
  type ContextMenuEvent,
  type InputModifiers,
  type Point,
  type PointerKind,
  type PredictedPoint,
  type ToolPointerEvent,
} from '@kujam/core';
import type { RendererLayers } from '../mount.js';

/** Screen distance a press must travel before it becomes a drag (ADR-004). */
export const DRAG_THRESHOLD_MOUSE = 3;
export const DRAG_THRESHOLD_PEN = 4;
export const DRAG_THRESHOLD_TOUCH = 8;

/**
 * Duration of a touch/pen press without significant movement before triggering a context menu (BOARD-912, ADR-004).
 *
 * @public
 */
export const LONG_PRESS_MS = 500;

/** Minimum pressure for the first pen event to prevent lost stroke starts (ADR-004). */
export const MIN_PEN_PRESSURE = 0.05;

/** Longest touch that still counts as a two- or three-finger tap (BOARD-911). */
export const TAP_GESTURE_MAX_MS = 300;

/** Pan speed in CSS pixels per millisecond below which a released pan does not glide (BOARD-911). */
const INERTIA_MIN_SPEED = 0.3;
/** Glide speed at which the inertia animation stops. */
const INERTIA_STOP_SPEED = 0.02;
/** Speed kept per 16 ms frame while gliding. */
const INERTIA_FRICTION = 0.92;
/** Window of pan samples used for the release velocity. */
const INERTIA_SAMPLE_MS = 100;
/** A pan resting longer than this before release does not glide. */
const INERTIA_REST_MS = 50;
/** Shortest sample window for a release velocity; events closer together have unreliable times. */
const INERTIA_MIN_WINDOW_MS = 8;
/** Fastest glide start, in CSS pixels per millisecond. */
const INERTIA_MAX_SPEED = 4;

/**
 * What one finger does with drawing tools, that is every tool except Select and Hand (BOARD-911,
 * ADR-004):
 *
 * - `auto`: fingers draw until a pen is used on the view. From then on one finger pans the camera,
 *   and touches while the pen is down are ignored (palm rejection).
 * - `pan`: "pen draws, fingers pan". One finger always pans; only the pen and the mouse draw.
 * - `draw`: fingers always draw, without palm rejection.
 *
 * Two fingers pinch and pan in every mode.
 *
 * @beta
 */
export type FingerMode = 'auto' | 'pan' | 'draw';

/**
 * Touch and stylus behavior of a view (BOARD-911).
 *
 * @beta
 */
export interface TouchOptions {
  /** What one finger does with drawing tools. Defaults to `auto`. */
  readonly fingers?: FingerMode;
  /** Two-finger tap undoes and three-finger tap redoes. Defaults to `true`. */
  readonly tapGestures?: boolean;
  /**
   * The camera keeps gliding after a touch pan or pinch is released. Defaults to `true`; never
   * with reduced motion (BOARD-1905).
   */
  readonly inertia?: boolean;
}

/** Touch options with every default filled in. */
export type ResolvedTouchOptions = Readonly<Required<TouchOptions>>;

const DEFAULT_TOUCH_OPTIONS: ResolvedTouchOptions = Object.freeze({
  fingers: 'auto',
  tapGestures: true,
  inertia: true,
});

/**
 * Merges `patch` into `base` (the defaults when omitted).
 *
 * @throws `RangeError` when `fingers` is not `auto`, `pan`, or `draw`.
 * @internal
 */
export function resolveTouchOptions(
  patch: TouchOptions | undefined,
  base: ResolvedTouchOptions = DEFAULT_TOUCH_OPTIONS,
): ResolvedTouchOptions {
  if (patch === undefined) return base;
  const fingers = patch.fingers ?? base.fingers;
  if (fingers !== 'auto' && fingers !== 'pan' && fingers !== 'draw') {
    throw new RangeError('Opsi touch.fingers wajib bernilai auto, pan, atau draw.');
  }
  return Object.freeze({
    fingers,
    tapGestures: patch.tapGestures === undefined ? base.tapGestures : Boolean(patch.tapGestures),
    inertia: patch.inertia === undefined ? base.inertia : Boolean(patch.inertia),
  });
}

/** Safari macOS gesture event with scale factor. */
interface SafariGestureEvent extends UIEvent {
  readonly scale: number;
  readonly clientX: number;
  readonly clientY: number;
}

interface PointerState {
  readonly id: number;
  readonly type: PointerKind;
  readonly startScreen: Point;
  lastScreen: Point;
  lastPoint: Point;
  isDragging: boolean;
  /**
   * Whether this touch pans the camera instead of reaching the tool: on empty space with the
   * select tool (ADR-004), or with a drawing tool while fingers pan (BOARD-911).
   */
  isTouchEmptyPan: boolean;
  /** Whether a long press triggered a context menu for this pointer press (BOARD-912). */
  longPressTriggered?: boolean;
  /**
   * A long press on empty space with the select tool (BOARD-911): dragging now draws a selection
   * box, and releasing without a drag opens the context menu.
   */
  marqueeArmed?: boolean;
}

/** Touches of one multi-finger tap candidate, from the first finger down to the last one up. */
interface TapSession {
  readonly start: number;
  /** Start position of each finger still down. */
  readonly fingers: Map<number, Point>;
  /** Most fingers down at once. */
  max: number;
  /** A finger moved beyond the touch drag threshold, or the session must not fire. */
  void: boolean;
}

/** Camera pan in CSS pixels at a time, for the release velocity. */
interface PanSample {
  readonly time: number;
  readonly dx: number;
  readonly dy: number;
}

interface TwoFingerState {
  readonly id1: number;
  readonly id2: number;
  lastDistance: number;
  lastCenterScreen: Point;
}

function extractModifiers(e: MouseEvent | KeyboardEvent | TouchEvent): InputModifiers {
  return {
    shift: Boolean(e.shiftKey),
    alt: Boolean(e.altKey),
    ctrl: Boolean(e.ctrlKey),
    meta: Boolean(e.metaKey),
  };
}

function pointerKind(raw: string): PointerKind {
  if (raw === 'pen') return 'pen';
  if (raw === 'touch') return 'touch';
  return 'mouse';
}

/** Longest pause between presses that still counts as a double (or triple) click. */
const MULTI_CLICK_MS = 500;

function dragThreshold(type: PointerKind): number {
  if (type === 'touch') return DRAG_THRESHOLD_TOUCH;
  if (type === 'pen') return DRAG_THRESHOLD_PEN;
  return DRAG_THRESHOLD_MOUSE;
}

function resolvePressure(e: PointerEvent, type: PointerKind, isFirst: boolean): number {
  if (type === 'mouse') {
    return e.buttons !== 0 ? 0.5 : 0;
  }
  if (type === 'touch') {
    return 0.5;
  }
  // Pen
  if (isFirst && e.pressure === 0 && e.buttons !== 0) {
    return MIN_PEN_PRESSURE;
  }
  return e.pressure;
}

function isTextInput(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return false;
}

function distance(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

function midpoint(p1: Point, p2: Point): Point {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
}

export interface AttachInputOptions {
  onHover?: (id: string | null) => void;
  onEvent?: (event: BoardInputEvent) => void;
  /**
   * Called when a context menu is requested via right-click or long-press (BOARD-912).
   */
  onContextMenu?: (event: ContextMenuEvent) => void;
  /**
   * Called before a `keydown` is sent to the board; `false` skips the board and keeps the
   * browser's default action (BOARD-1902, for example Tab leaving the board).
   */
  filterKey?: (e: KeyboardEvent) => boolean;
  /** Called after a `keydown` was sent to the board (or skipped), with whether it was handled. */
  afterKey?: (e: KeyboardEvent, handled: boolean) => void;
  /** Current touch options (BOARD-911); the defaults when omitted. */
  touch?: () => ResolvedTouchOptions;
  /** Called with the screen position of a hovering pen, or `null` when it leaves (BOARD-911). */
  onPenHover?: (screen: Point | null) => void;
}

/**
 * Handle returned by {@link attachInput}.
 *
 * @internal
 */
export interface InputHandle {
  /** Whether a pen was used on this view, which turns on palm rejection in `auto` mode. */
  readonly penDetected: boolean;
  /** Removes every listener and stops a running glide. */
  detach(): void;
}

/**
 * Attaches DOM input event listeners to the board's root and canvas elements (BOARD-806).
 *
 * @internal
 */
export function attachInput(
  board: Board,
  layers: RendererLayers,
  options?: AttachInputOptions,
): InputHandle {
  const { root, canvas } = layers;
  const win = root.ownerDocument.defaultView;

  function dispatch(event: BoardInputEvent): boolean {
    const handled = board.dispatch(event);
    options?.onEvent?.(event);
    return handled;
  }

  root.style.touchAction = 'none';
  root.style.userSelect = 'none';
  (root.style as unknown as { webkitUserSelect: string }).webkitUserSelect = 'none';
  root.tabIndex = 0;
  root.style.outline = 'none';
  canvas.style.touchAction = 'none';

  const activePointers = new Map<number, PointerState>();
  let primaryPointerId: number | null = null;
  let twoFinger: TwoFingerState | null = null;
  let lastSafariScale = 1;
  let currentHoverId: string | null = null;
  // Chromium and Firefox report `detail` 0 on pointer events, so presses are counted here.
  let lastPress: { time: number; screen: Point; kind: PointerKind; count: number } | null = null;
  let clickCount = 1;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastContextMenuTime = 0;
  /** A pen touched this view; `auto` finger mode then rejects palms (BOARD-911). */
  let penDetected = false;
  /** Touches ignored until they lift: palms resting while the pen draws (BOARD-911). */
  const ignoredTouches = new Set<number>();
  let tap: TapSession | null = null;
  let panSamples: PanSample[] = [];
  let inertiaFrame: number | null = null;
  let penHovering = false;

  function touchOptions(): ResolvedTouchOptions {
    return options?.touch?.() ?? DEFAULT_TOUCH_OPTIONS;
  }

  /** Whether one finger pans instead of drawing (BOARD-911). */
  function fingersPan(): boolean {
    const mode = touchOptions().fingers;
    return mode === 'pan' || (mode === 'auto' && penDetected);
  }

  /** Whether touches are ignored while a pen is down. */
  function palmRejection(): boolean {
    return touchOptions().fingers !== 'draw';
  }

  function setPenHover(screen: Point | null): void {
    if (screen === null && !penHovering) return;
    penHovering = screen !== null;
    options?.onPenHover?.(screen);
  }

  // ---------- Inertia (BOARD-911) ----------

  function stopInertia(): void {
    if (inertiaFrame !== null) {
      win?.cancelAnimationFrame?.(inertiaFrame);
      inertiaFrame = null;
    }
  }

  function panCamera(dx: number, dy: number): void {
    const { x, y, zoom } = board.camera.get();
    board.camera.set({ x: x - dx / zoom, y: y - dy / zoom });
  }

  function recordPan(time: number, dx: number, dy: number): void {
    panSamples.push({ time, dx, dy });
    while (panSamples.length > 0 && time - panSamples[0]!.time > INERTIA_SAMPLE_MS) {
      panSamples.shift();
    }
  }

  /** Starts gliding with the velocity of the last pan samples, then clears them. */
  function releasePan(time: number): void {
    const samples = panSamples;
    panSamples = [];
    if (!touchOptions().inertia || board.camera.reducedMotion || samples.length < 2) return;
    const last = samples[samples.length - 1]!;
    if (time - last.time > INERTIA_REST_MS) return;
    const first = samples[0]!;
    const elapsed = last.time - first.time;
    if (elapsed < INERTIA_MIN_WINDOW_MS) return;
    // The first sample is the movement before `first.time`, so it is left out of the sum.
    let dx = 0;
    let dy = 0;
    for (let i = 1; i < samples.length; i++) {
      dx += samples[i]!.dx;
      dy += samples[i]!.dy;
    }
    let vx = dx / elapsed;
    let vy = dy / elapsed;
    const speed = Math.hypot(vx, vy);
    if (speed < INERTIA_MIN_SPEED || typeof win?.requestAnimationFrame !== 'function') return;
    if (speed > INERTIA_MAX_SPEED) {
      vx *= INERTIA_MAX_SPEED / speed;
      vy *= INERTIA_MAX_SPEED / speed;
    }
    stopInertia();
    let previous: number | null = null;
    const step = (now: number): void => {
      const dt = previous === null ? 16 : Math.min(64, Math.max(1, now - previous));
      previous = now;
      panCamera(vx * dt, vy * dt);
      const decay = Math.pow(INERTIA_FRICTION, dt / 16);
      vx *= decay;
      vy *= decay;
      inertiaFrame =
        Math.hypot(vx, vy) < INERTIA_STOP_SPEED ? null : win.requestAnimationFrame(step);
    };
    inertiaFrame = win.requestAnimationFrame(step);
  }

  // ---------- Multi-finger taps (BOARD-911) ----------

  function tapFingerDown(id: number, screen: Point, time: number): void {
    if (!tap) tap = { start: time, fingers: new Map(), max: 0, void: false };
    tap.fingers.set(id, screen);
    tap.max = Math.max(tap.max, tap.fingers.size);
  }

  function tapFingerMove(id: number, screen: Point): void {
    const start = tap?.fingers.get(id);
    if (tap && start && distance(start, screen) >= DRAG_THRESHOLD_TOUCH) tap.void = true;
  }

  /** Removes a finger; when it was the last one, runs undo (two fingers) or redo (three). */
  function tapFingerUp(id: number, time: number, cancelled: boolean): void {
    if (!tap || !tap.fingers.has(id)) return;
    tap.fingers.delete(id);
    if (cancelled) tap.void = true;
    if (tap.fingers.size > 0) return;
    const session = tap;
    tap = null;
    if (session.void || time - session.start > TAP_GESTURE_MAX_MS) return;
    if (!touchOptions().tapGestures || board.readOnly) return;
    if (session.max === 2) board.undo();
    else if (session.max === 3) board.redo();
  }

  /** Drops every touch in progress (a pen took over): rolls back its action and ignores it. */
  function dropTouches(e: PointerEvent): void {
    if (twoFinger) {
      dispatch({
        type: 'pinch',
        phase: 'end',
        point: board.camera.screenToBoard(twoFinger.lastCenterScreen),
        screen: twoFinger.lastCenterScreen,
        scale: 1,
        deltaX: 0,
        deltaY: 0,
      });
      twoFinger = null;
    } else if (primaryPointerId !== null) {
      const primary = activePointers.get(primaryPointerId);
      if (primary && primary.type === 'touch' && !primary.isTouchEmptyPan) {
        dispatch(cancelEvent(primary, e));
      }
    }
    for (const [id, state] of activePointers) {
      if (state.type !== 'touch') continue;
      activePointers.delete(id);
      ignoredTouches.add(id);
      try {
        canvas.releasePointerCapture(id);
      } catch {
        // Ignore
      }
    }
    if (primaryPointerId !== null && !activePointers.has(primaryPointerId)) primaryPointerId = null;
    clearLongPress();
    tap = null;
    panSamples = [];
  }

  function cancelEvent(state: PointerState, e: PointerEvent | KeyboardEvent): ToolPointerEvent {
    return {
      type: 'pointer-cancel',
      pointerId: state.id,
      pointerType: state.type,
      point: state.lastPoint,
      screen: state.lastScreen,
      pressure: 0,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 0,
      modifiers: extractModifiers(e),
    };
  }

  /** Selects the element under a press and opens the context menu there (BOARD-912). */
  function openContextMenu(state: PointerState): void {
    const hit = board.hitTest(state.lastPoint, { tolerance: dragThreshold(state.type) });
    if (hit && !hit.locked) {
      if (!board.selection.includes(hit.id)) {
        board.select(hit.id);
      }
    } else if (!hit) {
      board.clearSelection();
    }

    const rect =
      typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null;
    const client: Point = {
      x: (rect?.left ?? 0) + state.lastScreen.x,
      y: (rect?.top ?? 0) + state.lastScreen.y,
    };

    const ctxEvent = createContextMenuEvent({
      board,
      screen: state.lastScreen,
      point: state.lastPoint,
      client,
      targetId: hit?.id ?? null,
    });
    lastContextMenuTime = Date.now();
    board.emit('contextmenu', ctxEvent);
    options?.onContextMenu?.(ctxEvent);
  }

  function clearLongPress(): void {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  /** Counts a press as the next click of a series when it is quick and close to the last one. */
  function countPress(e: PointerEvent, screen: Point, kind: PointerKind): void {
    const time = e.timeStamp;
    const near =
      lastPress !== null &&
      lastPress.kind === kind &&
      time - lastPress.time <= MULTI_CLICK_MS &&
      Math.hypot(screen.x - lastPress.screen.x, screen.y - lastPress.screen.y) <=
        dragThreshold(kind);
    clickCount = e.detail > 0 ? e.detail : near ? lastPress!.count + 1 : 1;
    lastPress = { time, screen, kind, count: clickCount };
  }

  function toScreen(clientX?: number, clientY?: number): Point {
    const rect = typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null;
    const left = rect && Number.isFinite(rect.left) ? rect.left : 0;
    const top = rect && Number.isFinite(rect.top) ? rect.top : 0;
    const x = typeof clientX === 'number' && Number.isFinite(clientX) ? clientX - left : 0;
    const y = typeof clientY === 'number' && Number.isFinite(clientY) ? clientY - top : 0;
    return { x, y };
  }

  function createPointerEvent(
    type: ToolPointerEvent['type'],
    e: PointerEvent,
    screen: Point,
    point: Point,
    kind: PointerKind,
    isFirst = false,
    predicted?: readonly PredictedPoint[],
  ): ToolPointerEvent {
    // Stylus eraser button check: buttons & 32 -> button 5
    let button = e.button;
    if ((e.buttons & 32) !== 0) {
      button = 5;
    }
    return {
      ...(predicted && predicted.length > 0 ? { predicted } : {}),
      type,
      pointerId: e.pointerId,
      pointerType: kind,
      point,
      screen,
      pressure: resolvePressure(e, kind, isFirst),
      tiltX: e.tiltX ?? 0,
      tiltY: e.tiltY ?? 0,
      button,
      buttons: e.buttons,
      modifiers: extractModifiers(e),
      clickCount: e.detail || clickCount,
    };
  }

  // ---------- Pointer Event Handlers ----------

  function onPointerDown(e: PointerEvent): void {
    if (e.target !== canvas && !root.contains(e.target as Node)) return;
    stopInertia();

    if (currentHoverId !== null) {
      currentHoverId = null;
      options?.onHover?.(null);
    }

    // `preventDefault` below also suppresses the focus change of `mousedown`, so focus the view
    // here: keyboard shortcuts and clipboard events (BOARD-906) only reach a focused view.
    if (!root.contains(root.ownerDocument.activeElement) && typeof root.focus === 'function') {
      root.focus({ preventScroll: true });
    }

    const kind = pointerKind(e.pointerType);
    const screen = toScreen(e.clientX, e.clientY);
    const point = board.camera.screenToBoard(screen);

    if (kind === 'pen') {
      setPenHover(null);
      if (palmRejection()) {
        penDetected = true;
        // A palm or finger was down before the pen: the pen wins (BOARD-911).
        dropTouches(e);
      }
    } else if (kind === 'touch') {
      const penDown = [...activePointers.values()].some((p) => p.type === 'pen');
      if (penDown && palmRejection()) {
        ignoredTouches.add(e.pointerId);
        e.preventDefault();
        return;
      }
      if (e.button !== 2) tapFingerDown(e.pointerId, screen, e.timeStamp);
    }

    if (e.button === 2) {
      // Right-click: hit-test to update selection, prevent starting tool actions (BOARD-912)
      const hit = board.hitTest(point, { tolerance: 4 });
      if (hit && !hit.locked) {
        if (!board.selection.includes(hit.id)) {
          board.select(hit.id);
        }
      } else if (!hit) {
        board.clearSelection();
      }
      e.preventDefault();
      return;
    }

    // 3rd and subsequent pointers are ignored
    if (activePointers.size >= 2) {
      e.preventDefault();
      return;
    }

    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Browsers or test environments without capture support
    }

    if (activePointers.size === 0) {
      // First pointer: becomes primary
      primaryPointerId = e.pointerId;
      countPress(e, screen, kind);

      // Special touch rule with select tool: one-finger drag on empty space pans camera (ADR-004).
      // With a drawing tool, one finger pans too while fingers do not draw (BOARD-911).
      const tool = board.tool;
      const isTouchEmpty =
        kind === 'touch' &&
        (tool === 'select'
          ? !board.hitTest(point, { tolerance: dragThreshold(kind) })
          : tool !== 'hand' && tool !== null && fingersPan());

      // Long press timer for touch or pen (BOARD-912, ADR-004)
      if (kind === 'touch' || kind === 'pen') {
        clearLongPress();
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          const current = activePointers.get(e.pointerId);
          if (!current || current.isDragging) return;
          if (current.isTouchEmptyPan && board.tool === 'select') {
            // Empty space: a drag now draws a selection box; the menu waits for the release
            // (BOARD-911).
            current.marqueeArmed = true;
            return;
          }
          if (current.isTouchEmptyPan) return;
          current.longPressTriggered = true;
          openContextMenu(current);
        }, LONG_PRESS_MS);
      }

      const state: PointerState = {
        id: e.pointerId,
        type: kind,
        startScreen: screen,
        lastScreen: screen,
        lastPoint: point,
        isDragging: false,
        isTouchEmptyPan: isTouchEmpty,
      };
      activePointers.set(e.pointerId, state);

      if (!isTouchEmpty) {
        dispatch(createPointerEvent('pointer-down', e, screen, point, kind, true));
      }
    } else if (activePointers.size === 1 && primaryPointerId !== null) {
      // Second pointer touched down: cancel primary pointer action and begin 2-finger gesture (ADR-004)
      clearLongPress();
      panSamples = [];
      const primary = activePointers.get(primaryPointerId);
      if (primary && !primary.isTouchEmptyPan) {
        dispatch(cancelEvent(primary, e));
      }

      const p2State: PointerState = {
        id: e.pointerId,
        type: kind,
        startScreen: screen,
        lastScreen: screen,
        lastPoint: point,
        isDragging: false,
        isTouchEmptyPan: false,
      };
      activePointers.set(e.pointerId, p2State);

      const p1 = primary!;
      const centerScreen = midpoint(p1.lastScreen, screen);
      const centerBoard = board.camera.screenToBoard(centerScreen);
      const dist = Math.max(1, distance(p1.lastScreen, screen));

      twoFinger = {
        id1: p1.id,
        id2: e.pointerId,
        lastDistance: dist,
        lastCenterScreen: centerScreen,
      };

      dispatch({
        type: 'pinch',
        phase: 'start',
        point: centerBoard,
        screen: centerScreen,
        scale: 1,
        deltaX: 0,
        deltaY: 0,
      });
    }

    e.preventDefault();
  }

  function handleSinglePointerMove(
    state: PointerState,
    e: PointerEvent,
    predicted?: readonly PredictedPoint[],
  ): void {
    const screen = toScreen(e.clientX, e.clientY);
    const point = board.camera.screenToBoard(screen);
    const threshold = dragThreshold(state.type);
    if (state.type === 'touch') tapFingerMove(state.id, screen);

    if (!state.isDragging) {
      const travel = distance(state.startScreen, screen);
      if (travel >= threshold) {
        state.isDragging = true;
        clearLongPress();
        if (state.marqueeArmed) {
          // Long press, then drag on empty space: a selection box from the press (BOARD-911).
          state.marqueeArmed = false;
          state.isTouchEmptyPan = false;
          const startPoint = board.camera.screenToBoard(state.startScreen);
          dispatch({
            ...createPointerEvent(
              'pointer-down',
              e,
              state.startScreen,
              startPoint,
              state.type,
              true,
            ),
            button: 0,
            clickCount: 1,
          });
        }
      }
    }

    if (state.isTouchEmptyPan) {
      if (state.isDragging) {
        // One-finger touch in empty space pans the camera (ADR-004)
        const dx = screen.x - state.lastScreen.x;
        const dy = screen.y - state.lastScreen.y;
        panCamera(dx, dy);
        recordPan(e.timeStamp, dx, dy);
      }
    } else {
      if (state.type === 'touch' && state.isDragging && board.tool === 'hand') {
        recordPan(e.timeStamp, screen.x - state.lastScreen.x, screen.y - state.lastScreen.y);
      }
      dispatch(createPointerEvent('pointer-move', e, screen, point, state.type, false, predicted));
    }

    state.lastScreen = screen;
    state.lastPoint = point;
  }

  /**
   * Shares the pointer position with collaborators through `board.presence` (BOARD-1504), also
   * while hovering, which tools never see. The presence layer throttles it. `null` hides it.
   */
  function publishCursor(e: PointerEvent | null): void {
    const presence = board.presence;
    if (!presence) return;
    if (e === null) {
      presence.setLocalState({ cursor: null });
      return;
    }
    const point = board.camera.screenToBoard(toScreen(e.clientX, e.clientY));
    presence.setLocalState({ cursor: { x: point.x, y: point.y } });
  }

  function onPointerMove(e: PointerEvent): void {
    if (ignoredTouches.has(e.pointerId)) return;
    publishCursor(e);
    if (!activePointers.has(e.pointerId)) {
      if (tap?.fingers.has(e.pointerId)) {
        tapFingerMove(e.pointerId, toScreen(e.clientX, e.clientY));
        return;
      }
      if (e.buttons === 0) {
        const kind = pointerKind(e.pointerType);
        const screen = toScreen(e.clientX, e.clientY);
        const point = board.camera.screenToBoard(screen);
        const hit = board.hitTest(point, { tolerance: 4 });
        const nextHover = hit && !hit.locked ? hit.id : null;
        if (nextHover !== currentHoverId) {
          currentHoverId = nextHover;
          options?.onHover?.(nextHover);
        }
        // Tools with hover feedback: connector anchors, the select tool's quick-connect dots, and
        // the line tool's next segment (BOARD-1106). A hovering pen reaches every tool, for the
        // brush tip preview (BOARD-911); devices without pen hover never send these events.
        if (kind === 'pen') setPenHover(screen);
        if (
          kind === 'pen' ||
          board.tool === 'connector' ||
          board.tool === 'select' ||
          board.tool === 'line'
        ) {
          dispatch(createPointerEvent('pointer-move', e, screen, point, kind));
        }
      }
      return;
    }

    if (twoFinger && (e.pointerId === twoFinger.id1 || e.pointerId === twoFinger.id2)) {
      // 2-finger gesture update
      const p1 = activePointers.get(twoFinger.id1);
      const p2 = activePointers.get(twoFinger.id2);
      if (!p1 || !p2) return;

      const currentScreen = toScreen(e.clientX, e.clientY);
      tapFingerMove(e.pointerId, currentScreen);
      if (e.pointerId === twoFinger.id1) {
        p1.lastScreen = currentScreen;
      } else {
        p2.lastScreen = currentScreen;
      }

      const center = midpoint(p1.lastScreen, p2.lastScreen);
      const dist = Math.max(1, distance(p1.lastScreen, p2.lastScreen));
      const scale = dist / twoFinger.lastDistance;
      const deltaX = center.x - twoFinger.lastCenterScreen.x;
      const deltaY = center.y - twoFinger.lastCenterScreen.y;

      twoFinger.lastDistance = dist;
      twoFinger.lastCenterScreen = center;
      recordPan(e.timeStamp, deltaX, deltaY);

      dispatch({
        type: 'pinch',
        phase: 'update',
        point: board.camera.screenToBoard(center),
        screen: center,
        scale,
        deltaX,
        deltaY,
      });
      e.preventDefault();
      return;
    }

    const state = activePointers.get(e.pointerId);
    if (!state || e.pointerId !== primaryPointerId) return;

    // A mouse moving with no button down was released without a `pointerup` reaching the canvas
    // (see `onLostPointerCapture`): end the gesture here instead of dragging on.
    if (state.type === 'mouse' && e.buttons === 0) {
      clearLongPress();
      releasePointer(e, toScreen(e.clientX, e.clientY));
      return;
    }

    // Use coalesced events for higher stroke accuracy when available (ADR-004), and predicted
    // events to draw ahead of the pointer (BOARD-911). Only the last move carries predictions.
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const predicted = predictedPoints(e, state.type);
    if (coalesced && coalesced.length > 1) {
      coalesced.forEach((ce, i) => {
        handleSinglePointerMove(state, ce, i === coalesced.length - 1 ? predicted : undefined);
      });
    } else {
      handleSinglePointerMove(state, e, predicted);
    }

    e.preventDefault();
  }

  /** Positions from `getPredictedEvents()`, in board coordinates (BOARD-911). */
  function predictedPoints(e: PointerEvent, kind: PointerKind): PredictedPoint[] | undefined {
    if (typeof e.getPredictedEvents !== 'function') return undefined;
    let events: PointerEvent[];
    try {
      events = e.getPredictedEvents();
    } catch {
      return undefined;
    }
    if (!events || events.length === 0) return undefined;
    return events.map((pe) => {
      const p = board.camera.screenToBoard(toScreen(pe.clientX, pe.clientY));
      return { x: p.x, y: p.y, pressure: resolvePressure(pe, kind, false) };
    });
  }

  function onPointerUp(e: PointerEvent): void {
    clearLongPress();
    if (ignoredTouches.delete(e.pointerId)) return;
    if (pointerKind(e.pointerType) === 'touch') tapFingerUp(e.pointerId, e.timeStamp, false);
    if (!activePointers.has(e.pointerId)) return;
    releasePointer(e, toScreen(e.clientX, e.clientY));
  }

  /**
   * A capture lost with no button pressed is a release whose `pointerup` comes late or never: a
   * macOS trackpad can report a buttonless move before the button goes up, and Chromium then
   * drops the capture before `pointerup`. Ending the gesture as a cancel would roll back the drag
   * and the selection box, so it ends as a release at the last position. A capture lost while a
   * button is still down (taken by another element, canvas removed) still cancels.
   */
  function onLostPointerCapture(e: PointerEvent): void {
    const state = activePointers.get(e.pointerId);
    if (state && e.buttons === 0 && !twoFinger) {
      clearLongPress();
      releasePointer(e, state.lastScreen);
      return;
    }
    onPointerCancel(e);
  }

  /** Ends the gesture of an active pointer as a release at `screen`. */
  function releasePointer(e: PointerEvent, screen: Point): void {
    if (twoFinger && (e.pointerId === twoFinger.id1 || e.pointerId === twoFinger.id2)) {
      const center = twoFinger.lastCenterScreen;
      dispatch({
        type: 'pinch',
        phase: 'end',
        point: board.camera.screenToBoard(center),
        screen: center,
        scale: 1,
        deltaX: 0,
        deltaY: 0,
      });
      twoFinger = null;
      activePointers.delete(e.pointerId);
      primaryPointerId = null;
      releaseCapture(e.pointerId);
      releasePan(e.timeStamp);
      e.preventDefault();
      return;
    }

    const state = activePointers.get(e.pointerId);
    activePointers.delete(e.pointerId);
    if (primaryPointerId === e.pointerId) {
      primaryPointerId = null;
    }
    // Released only now: a `lostpointercapture` fired by the release finds no active pointer.
    releaseCapture(e.pointerId);

    if (!state) return;
    if (state.longPressTriggered) {
      e.preventDefault();
      return;
    }
    if (state.marqueeArmed) {
      // Long press on empty space without a drag: the context menu opens on release (BOARD-911).
      openContextMenu(state);
      e.preventDefault();
      return;
    }
    if (state.type === 'touch' && (state.isTouchEmptyPan || board.tool === 'hand')) {
      releasePan(e.timeStamp);
    }

    const point = board.camera.screenToBoard(screen);

    if (state.isTouchEmptyPan) {
      // Tap on empty space: clear selection
      if (!state.isDragging && board.tool === 'select') {
        board.clearSelection();
      }
    } else {
      dispatch(createPointerEvent('pointer-up', e, screen, point, state.type));
    }

    e.preventDefault();
  }

  function releaseCapture(pointerId: number): void {
    try {
      canvas.releasePointerCapture(pointerId);
    } catch {
      // Browsers or test environments without capture support
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    clearLongPress();
    if (ignoredTouches.delete(e.pointerId)) return;
    tapFingerUp(e.pointerId, e.timeStamp, true);
    if (!activePointers.has(e.pointerId)) return;

    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    if (twoFinger && (e.pointerId === twoFinger.id1 || e.pointerId === twoFinger.id2)) {
      dispatch({
        type: 'pinch',
        phase: 'end',
        point: board.camera.screenToBoard(twoFinger.lastCenterScreen),
        screen: twoFinger.lastCenterScreen,
        scale: 1,
        deltaX: 0,
        deltaY: 0,
      });
      twoFinger = null;
      activePointers.delete(e.pointerId);
      primaryPointerId = null;
      return;
    }

    const state = activePointers.get(e.pointerId);
    activePointers.delete(e.pointerId);
    if (primaryPointerId === e.pointerId) {
      primaryPointerId = null;
    }

    panSamples = [];
    if (state && !state.isTouchEmptyPan) {
      dispatch(cancelEvent(state, e));
    }
  }

  // ---------- Wheel and Trackpad Handlers ----------

  function onWheel(e: WheelEvent): void {
    stopInertia();
    const screen = toScreen(e.clientX, e.clientY);
    const point = board.camera.screenToBoard(screen);

    const handled = dispatch({
      type: 'wheel',
      point,
      screen,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      modifiers: extractModifiers(e),
    });

    if (handled || root.contains(e.target as Node)) {
      e.preventDefault();
    }
  }

  // Safari macOS trackpad GestureEvent support (ADR-004)
  function onGestureStart(e: Event): void {
    const ge = e as SafariGestureEvent;
    lastSafariScale = ge.scale || 1;
    const screen = toScreen(ge.clientX, ge.clientY);
    dispatch({
      type: 'pinch',
      phase: 'start',
      point: board.camera.screenToBoard(screen),
      screen,
      scale: 1,
      deltaX: 0,
      deltaY: 0,
    });
    e.preventDefault();
  }

  function onGestureChange(e: Event): void {
    const ge = e as SafariGestureEvent;
    const currentScale = ge.scale || 1;
    const deltaScale = currentScale / (lastSafariScale || 1);
    lastSafariScale = currentScale;

    const screen = toScreen(ge.clientX, ge.clientY);
    dispatch({
      type: 'pinch',
      phase: 'update',
      point: board.camera.screenToBoard(screen),
      screen,
      scale: deltaScale,
      deltaX: 0,
      deltaY: 0,
    });
    e.preventDefault();
  }

  function onGestureEnd(e: Event): void {
    const ge = e as SafariGestureEvent;
    const screen = toScreen(ge.clientX, ge.clientY);
    dispatch({
      type: 'pinch',
      phase: 'end',
      point: board.camera.screenToBoard(screen),
      screen,
      scale: 1,
      deltaX: 0,
      deltaY: 0,
    });
    lastSafariScale = 1;
    e.preventDefault();
  }

  // ---------- Keyboard Handlers ----------

  function onKeyDown(e: KeyboardEvent): void {
    // Only capture keyboard when the board is focused
    if (!root.contains(document.activeElement)) return;
    if (options?.filterKey && !options.filterKey(e)) {
      options.afterKey?.(e, false);
      return;
    }

    const handled = dispatch({
      type: 'key-down',
      key: e.key,
      code: e.code,
      repeat: e.repeat,
      modifiers: extractModifiers(e),
      inTextInput: isTextInput(e.target),
    });

    if (handled) {
      e.preventDefault();
    }
    options?.afterKey?.(e, handled);
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (!root.contains(document.activeElement)) return;

    const handled = dispatch({
      type: 'key-up',
      key: e.key,
      code: e.code,
      repeat: e.repeat,
      modifiers: extractModifiers(e),
      inTextInput: isTextInput(e.target),
    });

    if (handled) {
      e.preventDefault();
    }
  }

  function onPointerLeave(e: PointerEvent): void {
    if (pointerKind(e.pointerType) === 'pen') setPenHover(null);
    publishCursor(null);
    if (currentHoverId !== null) {
      currentHoverId = null;
      options?.onHover?.(null);
    }
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (Date.now() - lastContextMenuTime < 300) return;
    lastContextMenuTime = Date.now();

    const screen = toScreen(e.clientX, e.clientY);
    const point = board.camera.screenToBoard(screen);
    const client: Point = { x: e.clientX, y: e.clientY };

    const hit = board.hitTest(point, { tolerance: 4 });
    if (hit && !hit.locked) {
      if (!board.selection.includes(hit.id)) {
        board.select(hit.id);
      }
    } else if (!hit) {
      board.clearSelection();
    }

    const ctxEvent = createContextMenuEvent({
      board,
      screen,
      point,
      client,
      targetId: hit?.id ?? null,
    });
    board.emit('contextmenu', ctxEvent);
    options?.onContextMenu?.(ctxEvent);
  }

  // Attach event listeners
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('lostpointercapture', onLostPointerCapture as EventListener);
  canvas.addEventListener('contextmenu', onContextMenu);

  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('gesturestart', onGestureStart);
  root.addEventListener('gesturechange', onGestureChange);
  root.addEventListener('gestureend', onGestureEnd);

  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('keyup', onKeyUp);
  root.addEventListener('contextmenu', onContextMenu);

  function detach(): void {
    clearLongPress();
    stopInertia();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('lostpointercapture', onLostPointerCapture as EventListener);
    canvas.removeEventListener('contextmenu', onContextMenu);

    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('gesturestart', onGestureStart);
    root.removeEventListener('gesturechange', onGestureChange);
    root.removeEventListener('gestureend', onGestureEnd);

    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('keyup', onKeyUp);
    root.removeEventListener('contextmenu', onContextMenu);

    activePointers.clear();
    ignoredTouches.clear();
    primaryPointerId = null;
    twoFinger = null;
    tap = null;
    currentHoverId = null;
  }

  return {
    get penDetected() {
      return penDetected;
    },
    detach,
  };
}
