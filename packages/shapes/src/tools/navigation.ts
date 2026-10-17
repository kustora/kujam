/**
 * Camera navigation shared by the built-in tools: panning, wheel, and pinch (BOARD-502).
 *
 * @internal
 */

import type { Board, ToolPinchEvent, ToolWheelEvent } from '@kujam/core';

/** Zoom change per wheel delta pixel while Ctrl/Cmd is held (also trackpad pinch in browsers). */
export const WHEEL_ZOOM_SPEED = 0.01;

/** Moves the view by a screen-pixel drag: the board content follows the pointer. */
export function panBy(board: Board, dxScreen: number, dyScreen: number): void {
  const { x, y, zoom } = board.camera.get();
  board.camera.set({ x: x - dxScreen / zoom, y: y - dyScreen / zoom });
}

/** Wheel: zoom around the cursor with Ctrl/Cmd, otherwise scroll the view. */
export function handleWheel(board: Board, event: ToolWheelEvent): void {
  if (event.modifiers.ctrl || event.modifiers.meta) {
    board.camera.zoomBy(Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED), event.screen);
  } else {
    panBy(board, -event.deltaX, -event.deltaY);
  }
}

/** Pinch: zoom around the gesture center and follow the center as it moves. */
export function handlePinch(board: Board, event: ToolPinchEvent): void {
  if (event.scale !== 1 && Number.isFinite(event.scale) && event.scale > 0) {
    board.camera.zoomBy(event.scale, event.screen);
  }
  panBy(board, event.deltaX, event.deltaY);
}
