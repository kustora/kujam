/**
 * Text creation tool (BOARD-913).
 */

import { createBoxTool } from './box-tool.js';

/**
 * Tool for creating text elements.
 *
 * Click creates a 200×40 text box, drag creates a custom-sized text box.
 * Triggers inline text editing immediately after creation.
 * Remains active until Escape.
 *
 * @public
 */
export const textTool = createBoxTool({
  id: 'text',
  type: 'text',
  cursor: 'text',
  defaultSize: { w: 200, h: 40 },
  minSize: { w: 20, h: 20 },
  lockAspectWithShift: false,
  onCreated: (el, ctx) => {
    ctx.board.elementContext.emit('edit', { id: el.id });
  },
});
