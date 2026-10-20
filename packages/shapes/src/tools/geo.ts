/**
 * Geometric shape creation tools (BOARD-913).
 */

import type { ToolDefinition } from '@kujam/core';
import type { GeoKind } from '../elements/geo.js';
import { createBoxTool, type BoxToolData, type BoxToolState } from './box-tool.js';

/**
 * Creates a shape creation tool for the specified geometric kind. New shapes get the style
 * remembered under `board.toolStyles` key `geo`, shared by every shape tool (BOARD-1108).
 *
 * @public
 */
export function createGeoTool(
  kind: GeoKind = 'rectangle',
  id: string = `geo-${kind}`,
): ToolDefinition<BoxToolState, BoxToolData> {
  return createBoxTool({
    id,
    type: 'geo',
    cursor: 'crosshair',
    defaultSize: { w: 100, h: 100 },
    minSize: { w: 10, h: 10 },
    lockAspectWithShift: true,
    props: { geo: kind },
    // Every shape tool remembers one shared shape style (BOARD-1108).
    styleId: 'geo',
    // After drawing a shape, go back to selecting so it can be styled or moved right away.
    returnToSelect: true,
  });
}

/**
 * Default geometric shape tool (rectangle).
 *
 * @public
 */
export const geoTool = createGeoTool('rectangle', 'geo');

/**
 * Rectangle creation tool (R shortcut).
 *
 * @public
 */
export const rectangleTool = createGeoTool('rectangle', 'rectangle');

/**
 * Ellipse creation tool (O shortcut).
 *
 * @public
 */
export const ellipseTool = createGeoTool('ellipse', 'ellipse');

/**
 * Diamond creation tool (flowchart decision).
 *
 * @public
 */
export const diamondTool = createGeoTool('diamond', 'diamond');

/**
 * Triangle creation tool.
 *
 * @public
 */
export const triangleTool = createGeoTool('triangle', 'triangle');

/**
 * Inverted triangle creation tool (flowchart merge).
 *
 * @public
 */
export const triangleDownTool = createGeoTool('triangle-down', 'triangle-down');

/**
 * Pill creation tool (flowchart start and end).
 *
 * @public
 */
export const pillTool = createGeoTool('pill', 'pill');
