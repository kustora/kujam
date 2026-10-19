/**
 * Frame placement tool (BOARD-1105).
 *
 * @packageDocumentation
 */

import type { ToolDefinition } from '@kujam/core';
import { DEFAULT_FRAME_SIZE, type FrameProps } from '../elements/frame.js';
import { createBoxTool, type BoxToolData, type BoxToolState } from './box-tool.js';

/**
 * Tool for creating frame elements on the canvas (BOARD-1105).
 *
 * Automatically assigns sequential names ('Frame 1', 'Frame 2', ...) and auto-parents
 * any unparented elements enclosed within the created frame boundaries.
 *
 * @public
 */
export const frameTool: ToolDefinition<BoxToolState, BoxToolData> = createBoxTool<FrameProps>({
  id: 'frame',
  type: 'frame',
  defaultSize: DEFAULT_FRAME_SIZE,
  props: (board) => {
    const count = board.query({ type: 'frame' }).length;
    return {
      name: `Frame ${count + 1}`,
      fill: 'surface',
      clip: true,
    };
  },
  onCreated: (frame, ctx) => {
    // Find unparented elements on the same page completely enclosed inside the new frame
    const enclosed = ctx.board.query({ pageId: frame.pageId }).filter((el) => {
      if (el.id === frame.id || el.parentId !== null) return false;
      return (
        el.x >= frame.x &&
        el.x + el.w <= frame.x + frame.w &&
        el.y >= frame.y &&
        el.y + el.h <= frame.y + frame.h
      );
    });

    for (const el of enclosed) {
      ctx.board.update(el.id, { parentId: frame.id });
    }

    ctx.board.select([frame.id]);
    ctx.commit();
    if (ctx.board.tools.has('select')) {
      ctx.board.setTool('select');
    }
  },
});
