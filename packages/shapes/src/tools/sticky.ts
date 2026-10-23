/**
 * Sticky note creation tool (BOARD-913).
 */

import { createBoxTool } from './box-tool.js';

/**
 * Tool for creating sticky notes.
 *
 * Click creates a default 192×144 sticky (8×6 jam-grid, ratio 4:3), drag creates a sized sticky.
 * Triggers inline text editing immediately after creation.
 * Remains active until Escape.
 *
 * @public
 */
export const stickyTool = createBoxTool({
  id: 'sticky',
  type: 'sticky',
  cursor: 'crosshair',
  defaultSize: { w: 192, h: 144 },
  minSize: { w: 40, h: 40 },
  lockAspectWithShift: true,
  onCreated: (el, ctx) => {
    ctx.board.elementContext.emit('edit', { id: el.id });
  },
});
