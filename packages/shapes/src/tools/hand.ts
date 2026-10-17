import { defineTool, type CameraState, type Point } from '@kujam/core';
import { handlePinch, handleWheel, panBy } from './navigation.js';

/**
 * `ctx.data` of the hand tool.
 *
 * @beta
 */
export interface HandToolData {
  /** Screen position of the previous pointer event while panning. */
  last: Point | null;
  /** Camera when the drag started, restored when the drag is cancelled (Esc). */
  startCamera: Readonly<CameraState> | null;
}

/**
 * Hand tool (BOARD-502): dragging pans the camera; Esc during a drag restores the camera. Wheel
 * and pinch navigate like in the select tool. Also active temporarily while Space is held.
 *
 * @beta
 */
export const handTool = defineTool({
  id: 'hand',
  cursor: 'grab',
  initial: 'idle',
  data: (): HandToolData => ({ last: null, startCamera: null }),
  states: {
    idle: {
      onPointerDown(ctx, e) {
        if (e.button !== 0 && e.button !== 1) return;
        ctx.data.last = e.screen;
        ctx.data.startCamera = ctx.board.camera.get();
        return 'panning';
      },
      onWheel: (ctx, e) => handleWheel(ctx.board, e),
      onPinch: (ctx, e) => handlePinch(ctx.board, e),
    },
    panning: {
      cursor: 'grabbing',
      onPointerMove(ctx, e) {
        const last = ctx.data.last ?? e.screen;
        panBy(ctx.board, e.screen.x - last.x, e.screen.y - last.y);
        ctx.data.last = e.screen;
      },
      onPointerUp: () => 'idle',
      onCancel(ctx) {
        if (ctx.data.startCamera) ctx.board.camera.set(ctx.data.startCamera);
      },
    },
  },
});
