/**
 * Geometric shape creation tools (BOARD-913).
 */

import type { ToolDefinition } from '@kujam/core';
import type { GeoKind } from '../elements/geo.js';
import { createBoxTool, type BoxToolData, type BoxToolState } from './box-tool.js';

/**
 * Creates a shape creation tool for the specified geometric kind.
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
