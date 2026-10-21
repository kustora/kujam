/**
 * Input event pipeline for Pointer Events, multi-touch gestures, wheel, and keyboard (BOARD-806, ADR-004).
 */

import {
  createContextMenuEvent,
  type Board,
  type BoardInputEvent,
  type ContextMenuEvent,
  type InputModifiers,
  type Point,
  type PointerKind,
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
  /** Whether this touch started on empty space with the select tool (ADR-004 touch pan). */
  isTouchEmptyPan: boolean;
  /** Whether a long press triggered a context menu for this pointer press (BOARD-912). */
  longPressTriggered?: boolean;
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
): () => void {
  const { root, canvas } = layers;

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
  ): ToolPointerEvent {
    // Stylus eraser button check: buttons & 32 -> button 5
    let button = e.button;
    if ((e.buttons & 32) !== 0) {
      button = 5;
    }
    return {
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

      // Long press timer for touch or pen (BOARD-912, ADR-004)
      if (kind === 'touch' || kind === 'pen') {
        clearLongPress();
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          const current = activePointers.get(e.pointerId);
          if (!current || current.isDragging) return;
          current.longPressTriggered = true;

          const hit = board.hitTest(current.lastPoint, { tolerance: dragThreshold(kind) });
          if (hit && !hit.locked) {
            if (!board.selection.includes(hit.id)) {
              board.select(hit.id);
            }
          } else if (!hit) {
            board.clearSelection();
          }

          const rect = typeof root.getBoundingClientRect === 'function' ? root.getBoundingClientRect() : null;
          const client: Point = {
            x: (rect?.left ?? 0) + current.lastScreen.x,
            y: (rect?.top ?? 0) + current.lastScreen.y,
          };

          const ctxEvent = createContextMenuEvent({
            board,
            screen: current.lastScreen,
            point: current.lastPoint,
            client,
            targetId: hit?.id ?? null,
          });
          lastContextMenuTime = Date.now();
          board.emit('contextmenu', ctxEvent);
          options?.onContextMenu?.(ctxEvent);
        }, LONG_PRESS_MS);
      }

      // Special touch rule with select tool: one-finger drag on empty space pans camera (ADR-004)
      const isTouchEmpty =
        kind === 'touch' &&
        board.tool === 'select' &&
        !board.hitTest(point, { tolerance: dragThreshold(kind) });

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
      const primary = activePointers.get(primaryPointerId);
      if (primary && !primary.isTouchEmptyPan) {
        dispatch({
          type: 'pointer-cancel',
          pointerId: primary.id,
          pointerType: primary.type,
          point: primary.lastPoint,
          screen: primary.lastScreen,
          pressure: 0,
          tiltX: 0,
          tiltY: 0,
          button: 0,
          buttons: 0,
          modifiers: extractModifiers(e),
        });
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

  function handleSinglePointerMove(state: PointerState, e: PointerEvent): void {
    const screen = toScreen(e.clientX, e.clientY);
    const point = board.camera.screenToBoard(screen);
    const threshold = dragThreshold(state.type);

    if (!state.isDragging) {
      const travel = distance(state.startScreen, screen);
      if (travel >= threshold) {
        state.isDragging = true;
        clearLongPress();
      }
    }

    if (state.isTouchEmptyPan) {
      if (state.isDragging) {
        // One-finger touch in empty space pans the camera (ADR-004)
        const dx = screen.x - state.lastScreen.x;
        const dy = screen.y - state.lastScreen.y;
        const { x, y, zoom } = board.camera.get();
        board.camera.set({ x: x - dx / zoom, y: y - dy / zoom });
      }
    } else {
      dispatch(createPointerEvent('pointer-move', e, screen, point, state.type));
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
    publishCursor(e);
    if (!activePointers.has(e.pointerId)) {
      if (e.buttons === 0) {
        const screen = toScreen(e.clientX, e.clientY);
        const point = board.camera.screenToBoard(screen);
        const hit = board.hitTest(point, { tolerance: 4 });
        const nextHover = hit && !hit.locked ? hit.id : null;
        if (nextHover !== currentHoverId) {
          currentHoverId = nextHover;
          options?.onHover?.(nextHover);
        }
        // Tools with hover feedback: connector anchors, and the select tool's quick-connect dots.
        if (board.tool === 'connector' || board.tool === 'select') {
          dispatch(createPointerEvent('pointer-move', e, screen, point, pointerKind(e.pointerType)));
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

    // Use coalesced events for higher stroke accuracy when available (ADR-004)
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    if (coalesced && coalesced.length > 1) {
      for (const ce of coalesced) {
        handleSinglePointerMove(state, ce);
      }
    } else {
      handleSinglePointerMove(state, e);
    }

    e.preventDefault();
  }

  function onPointerUp(e: PointerEvent): void {
    clearLongPress();
    if (!activePointers.has(e.pointerId)) return;

    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

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
      e.preventDefault();
      return;
    }

    const state = activePointers.get(e.pointerId);
    activePointers.delete(e.pointerId);
    if (primaryPointerId === e.pointerId) {
      primaryPointerId = null;
    }

    if (!state) return;
    if (state.longPressTriggered) {
      e.preventDefault();
      return;
    }

    const screen = toScreen(e.clientX, e.clientY);
    const point = board.camera.screenToBoard(screen);

    if (state.isTouchEmptyPan) {
      // Tap on empty space: clear selection
      if (!state.isDragging) {
        board.clearSelection();
      }
    } else {
      dispatch(createPointerEvent('pointer-up', e, screen, point, state.type));
    }

    e.preventDefault();
  }

  function onPointerCancel(e: PointerEvent): void {
    clearLongPress();
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

    if (state && !state.isTouchEmptyPan) {
      dispatch({
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
      });
    }
  }

  // ---------- Wheel and Trackpad Handlers ----------

  function onWheel(e: WheelEvent): void {
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

  function onPointerLeave(): void {
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
  canvas.addEventListener('lostpointercapture', onPointerCancel as EventListener);
  canvas.addEventListener('contextmenu', onContextMenu);

  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('gesturestart', onGestureStart);
  root.addEventListener('gesturechange', onGestureChange);
  root.addEventListener('gestureend', onGestureEnd);

  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('keyup', onKeyUp);
  root.addEventListener('contextmenu', onContextMenu);

  return () => {
    clearLongPress();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('lostpointercapture', onPointerCancel as EventListener);
    canvas.removeEventListener('contextmenu', onContextMenu);

    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('gesturestart', onGestureStart);
    root.removeEventListener('gesturechange', onGestureChange);
    root.removeEventListener('gestureend', onGestureEnd);

    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('keyup', onKeyUp);
    root.removeEventListener('contextmenu', onContextMenu);

    activePointers.clear();
    primaryPointerId = null;
    twoFinger = null;
    currentHoverId = null;
  };
}
