/**
 * Overlay layer renderer (BOARD-805).
 *
 * Renders selection outlines, resize/rotate handles (fixed screen-pixel size),
 * selection brush box, snap guides, hover indicators, and remote presence cursors.
 */

import {
  selectionFrame,
  transformHandles,
  type Board,
  type BoxBounds,
  type ElementRecord,
  type SnapGuide,
} from '@kujam/core';
import { getStroke } from 'perfect-freehand';

export const SELECTION_COLOR = '#2f80ed';
export const SELECTION_LINE_WIDTH = 1.5;
export const HANDLE_SIZE_PX = 8;
export const ROTATE_HANDLE_RADIUS_PX = 4;
export const ROTATE_HANDLE_OFFSET_PX = 24;
export const SNAP_GUIDE_COLOR = '#e02874';
export const BRUSH_FILL_COLOR = 'rgba(47, 128, 237, 0.08)';
export const BRUSH_STROKE_COLOR = 'rgba(47, 128, 237, 0.8)';
export const HOVER_STROKE_COLOR = 'rgba(47, 128, 237, 0.5)';

export interface RemoteCursor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly color?: string;
  readonly name?: string;
}

export interface ActiveStrokeOverlay {
  readonly points: readonly (readonly number[])[];
  readonly color: string;
  readonly thickness: number;
  readonly brush?: string;
}

export interface OverlayRenderStats {
  rendered: boolean;
  selectedCount: number;
  hasBrush: boolean;
  hasActiveStroke: boolean;
  guidesCount: number;
  hoveredId: string | null;
}

interface ToolOverlayData {
  brush?: BoxBounds | null;
  guides?: readonly SnapGuide[];
  activeStroke?: ActiveStrokeOverlay | null;
}

function renderStrokeOutline(
  g: CanvasRenderingContext2D,
  outline: readonly (readonly [number, number])[] | readonly number[][],
): void {
  if (outline.length === 0) return;

  const first = outline[0];
  if (!first) return;

  g.beginPath();
  if (outline.length < 3) {
    g.moveTo(first[0] ?? 0, first[1] ?? 0);
    for (let i = 1; i < outline.length; i++) {
      const pt = outline[i];
      if (pt) g.lineTo(pt[0] ?? 0, pt[1] ?? 0);
    }
  } else {
    g.moveTo(first[0] ?? 0, first[1] ?? 0);
    for (let i = 0; i < outline.length; i++) {
      const p0 = outline[i]!;
      const p1 = outline[(i + 1) % outline.length]!;
      const midX = (p0[0]! + p1[0]!) / 2;
      const midY = (p0[1]! + p1[1]!) / 2;
      g.quadraticCurveTo(p0[0]!, p0[1]!, midX, midY);
    }
  }
  g.closePath();
  g.fill();
}

/**
 * Manages rendering of the overlay canvas layer.
 *
 * @internal
 */
export class OverlayRenderer {
  private hoveredId: string | null = null;
  private cursors: readonly RemoteCursor[] = [];
  private lastRenderedWasEmpty = false;

  constructor(private readonly board: Board) {}

  setHovered(id: string | null): boolean {
    if (this.hoveredId === id) return false;
    this.hoveredId = id;
    return true;
  }

  getHovered(): string | null {
    return this.hoveredId;
  }

  setCursors(cursors: readonly RemoteCursor[]): void {
    this.cursors = cursors;
  }

  render(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    pixelRatio: number,
  ): OverlayRenderStats {
    const { board } = this;
    const camera = board.camera;
    const zoom = camera.get().zoom;

    // 1. Gather selection elements
    const selectedElements: Readonly<ElementRecord>[] = [];
    for (const id of board.selection) {
      const el = board.getElement(id);
      if (el && !el.locked) {
        selectedElements.push(el);
      }
    }

    // 2. Gather tool data (brush, snap guides, active stroke)
    const toolData = board.toolData as ToolOverlayData | null;
    const brush = toolData?.brush ?? null;
    const guides = toolData?.guides ?? [];
    const activeStroke = toolData?.activeStroke ?? null;
    const hasActiveStroke = Boolean(activeStroke && activeStroke.points && activeStroke.points.length > 0);

    // 3. Hovered element
    const hoveredEl =
      this.hoveredId && !board.selection.includes(this.hoveredId)
        ? board.getElement(this.hoveredId)
        : null;

    // Always reset transform and clear backing store
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hasContent =
      selectedElements.length > 0 ||
      brush !== null ||
      guides.length > 0 ||
      hoveredEl !== null ||
      this.cursors.length > 0 ||
      hasActiveStroke;

    if (!hasContent) {
      return {
        rendered: false,
        selectedCount: 0,
        hasBrush: false,
        hasActiveStroke: false,
        guidesCount: 0,
        hoveredId: null,
      };
    }

    // --- A. Hover Indicator ---
    if (hoveredEl) {
      const center = camera.boardToScreen({
        x: hoveredEl.x + hoveredEl.w / 2,
        y: hoveredEl.y + hoveredEl.h / 2,
      });
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.translate(center.x, center.y);
      if (hoveredEl.rotation) {
        ctx.rotate((hoveredEl.rotation * Math.PI) / 180);
      }
      const sw = hoveredEl.w * zoom;
      const sh = hoveredEl.h * zoom;
      ctx.strokeStyle = HOVER_STROKE_COLOR;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }

    // --- B. Selection Frame and Handles ---
    if (selectedElements.length > 0) {
      const frame = selectionFrame(selectedElements, { registry: board.elements });
      if (frame) {
        const center = camera.boardToScreen({
          x: frame.x + frame.w / 2,
          y: frame.y + frame.h / 2,
        });
        const sw = frame.w * zoom;
        const sh = frame.h * zoom;

        // Selection rectangle outline & connector line
        ctx.save();
        ctx.scale(pixelRatio, pixelRatio);
        ctx.translate(center.x, center.y);
        if (frame.rotation) {
          ctx.rotate((frame.rotation * Math.PI) / 180);
        }
        ctx.strokeStyle = SELECTION_COLOR;
        ctx.lineWidth = SELECTION_LINE_WIDTH;
        ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);

        // Connector to rotate handle
        ctx.beginPath();
        ctx.moveTo(0, -sh / 2);
        ctx.lineTo(0, -sh / 2 - ROTATE_HANDLE_OFFSET_PX);
        ctx.stroke();
        ctx.restore();

        // 8 Resize handles + 1 Rotate handle (fixed screen pixels)
        const handles = transformHandles(frame, ROTATE_HANDLE_OFFSET_PX / zoom);
        ctx.save();
        ctx.scale(pixelRatio, pixelRatio);
        for (const pt of handles) {
          const s = camera.boardToScreen(pt);
          if (pt.handle === 'rotate') {
            ctx.beginPath();
            ctx.arc(s.x, s.y, ROTATE_HANDLE_RADIUS_PX, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = SELECTION_COLOR;
            ctx.lineWidth = SELECTION_LINE_WIDTH;
            ctx.stroke();
          } else {
            const hs = HANDLE_SIZE_PX;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(s.x - hs / 2, s.y - hs / 2, hs, hs);
            ctx.strokeStyle = SELECTION_COLOR;
            ctx.lineWidth = SELECTION_LINE_WIDTH;
            ctx.strokeRect(s.x - hs / 2, s.y - hs / 2, hs, hs);
          }
        }
        ctx.restore();
      }
    }

    // --- C. Selection Area Brush ---
    if (brush) {
      const p1 = camera.boardToScreen({ x: brush.minX, y: brush.minY });
      const p2 = camera.boardToScreen({ x: brush.maxX, y: brush.maxY });
      const bx = Math.min(p1.x, p2.x);
      const by = Math.min(p1.y, p2.y);
      const bw = Math.abs(p2.x - p1.x);
      const bh = Math.abs(p2.y - p1.y);

      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.fillStyle = BRUSH_FILL_COLOR;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = BRUSH_STROKE_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
    }

    // --- D. Snap Guides ---
    if (guides.length > 0) {
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.strokeStyle = SNAP_GUIDE_COLOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const g of guides) {
        if (g.axis === 'x') {
          const a = camera.boardToScreen({ x: g.position, y: g.from });
          const b = camera.boardToScreen({ x: g.position, y: g.to });
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        } else {
          const a = camera.boardToScreen({ x: g.from, y: g.position });
          const b = camera.boardToScreen({ x: g.to, y: g.position });
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // --- E. Presence Cursors ---
    if (this.cursors.length > 0) {
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      for (const cursor of this.cursors) {
        const s = camera.boardToScreen({ x: cursor.x, y: cursor.y });
        const color = cursor.color ?? '#f2994a';

        // Draw cursor pointer arrow
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x, s.y + 14);
        ctx.lineTo(s.x + 4, s.y + 10);
        ctx.lineTo(s.x + 10, s.y + 10);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();

        // Draw name badge if provided
        if (cursor.name) {
          ctx.font = '11px sans-serif';
          const textW = ctx.measureText(cursor.name).width;
          const badgeX = s.x + 12;
          const badgeY = s.y + 10;
          ctx.fillStyle = color;
          ctx.fillRect(badgeX, badgeY, textW + 8, 16);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(cursor.name, badgeX + 4, badgeY + 12);
        }
      }
      ctx.restore();
    }

    // --- F. Active Freehand Stroke Preview (BOARD-1002) ---
    if (activeStroke && activeStroke.points && activeStroke.points.length > 0) {
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      const cam = camera.get();
      ctx.translate(-cam.x * zoom, -cam.y * zoom);
      ctx.scale(zoom, zoom);

      const brush = board.elementContext
        ? board.elementContext.resolveBrush(activeStroke.brush ?? 'pen')
        : undefined;
      ctx.globalCompositeOperation = brush?.blend ?? 'source-over';
      ctx.fillStyle = activeStroke.color;

      const taper = brush?.strokeOptions.taper;
      const startTaper = typeof taper === 'object' && taper !== null ? taper.start : taper;
      const endTaper = typeof taper === 'object' && taper !== null ? taper.end : taper;

      const strokeOptions = {
        size: activeStroke.thickness,
        thinning: brush?.strokeOptions.thinning,
        smoothing: brush?.strokeOptions.smoothing,
        streamline: brush?.strokeOptions.streamline,
        simulatePressure: brush?.strokeOptions.simulatePressure,
        start: {
          taper: startTaper,
          cap: true,
        },
        end: {
          taper: endTaper,
          cap: true,
        },
        last: false,
      };

      const outline = getStroke(activeStroke.points as number[][], strokeOptions);
      renderStrokeOutline(ctx, outline);
      ctx.restore();
    }

    return {
      rendered: true,
      selectedCount: selectedElements.length,
      hasBrush: brush !== null,
      hasActiveStroke,
      guidesCount: guides.length,
      hoveredId: this.hoveredId,
    };
  }
}
