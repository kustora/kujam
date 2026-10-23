/**
 * Overlay layer renderer (BOARD-805).
 *
 * Renders selection outlines, resize/rotate handles (fixed screen-pixel size),
 * selection brush box, snap guides, hover indicators, and remote presence cursors.
 */

import {
  localToBoard,
  midpointHandles,
  QUICK_CONNECT_OFFSET_PX,
  quickConnectHandles,
  segmentHandles,
  selectionFrame,
  transformHandles,
  type Board,
  type BoxBounds,
  type ElementRecord,
  type Point,
  type PresenceApi,
  type PresenceLiveStroke,
  type SnapGuide,
} from '@kujam/core';
import { getStroke } from 'perfect-freehand';

/** Default selection outline stroke color (`#2F6FDB`). @public */
export const SELECTION_COLOR = '#2F6FDB';
/** Default selection outline stroke width in screen pixels. @public */
export const SELECTION_LINE_WIDTH = 2;
/** Resize handle square side length in screen pixels. @public */
export const HANDLE_SIZE_PX = 8;
/** Rotation handle circle radius in screen pixels. @public */
export const ROTATE_HANDLE_RADIUS_PX = 4;
/** Vertical offset of the rotation handle above the selection box in screen pixels. @public */
export const ROTATE_HANDLE_OFFSET_PX = 24;
/** Connector endpoint handle radius in screen pixels. @public */
export const CONNECTOR_HANDLE_RADIUS_PX = 5;
/** Quick-connect handle radius in screen pixels; larger while hovered. @public */
export const QUICK_CONNECT_RADIUS_PX = 5;
/** Length of the pill drawn on a draggable elbow connector segment, in screen pixels. @public */
export const SEGMENT_HANDLE_LENGTH_PX = 16;
/** Thickness of the elbow segment pill, in screen pixels. @public */
export const SEGMENT_HANDLE_THICKNESS_PX = 6;
/** Radius of a `line` point handle in screen pixels (BOARD-1106). @public */
export const LINE_POINT_HANDLE_RADIUS_PX = 5;
/** Radius of a `line` segment insertion handle in screen pixels (BOARD-1106). @public */
export const LINE_INSERT_HANDLE_RADIUS_PX = 3.5;
/** Shortest `line` segment, in screen pixels, that shows an insertion handle (BOARD-1106). @public */
export const LINE_INSERT_MIN_SEGMENT_PX = 24;
/** Alignment snap guide line color. @public */
export const SNAP_GUIDE_COLOR = '#e02874';
/** Marquee selection box fill color. @public */
export const BRUSH_FILL_COLOR = 'rgba(47, 111, 219, 0.08)';
/** Marquee selection box stroke color. @public */
export const BRUSH_STROKE_COLOR = 'rgba(47, 111, 219, 0.8)';
/** Hovered element outline stroke color. @public */
export const HOVER_STROKE_COLOR = 'rgba(47, 111, 219, 0.5)';
/** Default palette for remote collaborator cursors and selections. @public */
export const DEFAULT_COLLAB_COLORS = [
  '#2F6FDB',
  '#6B4FA0',
  '#16754C',
  '#C2410C',
  '#9B3D7F',
] as const;

/**
 * Inactivity timeout duration in milliseconds after which remote cursors are hidden (BOARD-808).
 * Defaults to 6,000 ms (~6 seconds).
 *
 * @public
 */
export const DEFAULT_CURSOR_INACTIVITY_MS = 6000;

/** Remote collaborator cursor state rendered on the overlay canvas. @public */
export interface RemoteCursor {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly color?: string;
  readonly name?: string;
  /** Timestamp in milliseconds of the last cursor activity for inactivity timeout calculation. */
  readonly lastActive?: number;
}

/** Remote collaborator selection rendered on the overlay canvas (BOARD-808). @public */
export interface RemoteSelection {
  readonly peerId: string;
  readonly elementIds: readonly string[];
  readonly color?: string;
  readonly name?: string;
}

/** In-progress freehand stroke rendered on the overlay layer before commit. @public */
export interface ActiveStrokeOverlay {
  readonly id?: string;
  readonly points: readonly (readonly number[])[];
  readonly color: string;
  readonly thickness: number;
  readonly brush?: string;
  /** Predicted points drawn after `points`, as a preview only (BOARD-911). */
  readonly predicted?: readonly (readonly number[])[];
}

/** Brush tip a freehand tool previews under a hovering pen (BOARD-911). */
interface BrushTipOverlay {
  readonly color: string;
  readonly thickness: number;
}

/** Anchor snap indicator rendered while dragging a connector endpoint. @public */
export interface ConnectorSnapOverlay {
  readonly elementId: string;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly point: { readonly x: number; readonly y: number };
  readonly candidates?: readonly { readonly x: number; readonly y: number }[];
}

/** Live path preview rendered on the overlay canvas while drawing a connector. @public */
export interface ConnectorPreviewOverlay {
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly style?: 'straight' | 'elbow' | 'curved';
  readonly bezier?: readonly [
    { readonly x: number; readonly y: number },
    { readonly x: number; readonly y: number },
    { readonly x: number; readonly y: number },
    { readonly x: number; readonly y: number },
  ];
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly dash?: 'solid' | 'dashed' | 'dotted';
}

/** Diagnostic metrics captured during an overlay layer render pass. @public */
export interface OverlayRenderStats {
  rendered: boolean;
  selectedCount: number;
  hasBrush: boolean;
  hasActiveStroke: boolean;
  guidesCount: number;
  hoveredId: string | null;
  /** Whether a visual drop target indicator is currently rendered (BOARD-608). */
  hasDropIndicator?: boolean;
  /** ID of the element highlighted as an element drop target, if any (BOARD-1208). */
  dropTargetId?: string | null;
  /** Number of remote collaborator elements currently selected (BOARD-808). */
  remoteSelectedCount?: number;
  /** Number of active remote cursors rendered (BOARD-808). */
  remoteCursorsCount?: number;
  /** Number of remote live strokes rendered (BOARD-808). */
  remoteLiveStrokesCount?: number;
  /** Whether remote cursors have pending position interpolation requiring another frame (BOARD-808). */
  hasPendingCursorAnimation?: boolean;
  /** Milliseconds until the next cursor inactivity timeout expires, if any (BOARD-808). */
  nextInactivityTimeoutMs?: number;
}

interface ToolOverlayData {
  brush?: BoxBounds | null;
  /** Free-form lasso path in board coordinates, closed implicitly (BOARD-910). */
  lasso?: readonly Point[] | null;
  guides?: readonly SnapGuide[];
  activeStroke?: ActiveStrokeOverlay | null;
  connectorSnap?: ConnectorSnapOverlay | null;
  connectorPreview?: ConnectorPreviewOverlay | null;
  /** Side of the quick-connect handle under the pointer. */
  quickConnectHover?: string | null;
  /** Element highlighted as the drop target of the dragged elements (BOARD-1208). */
  dropTargetId?: string | null;
  /** Brush tip of a freehand tool, drawn at the hovering pen (BOARD-911). */
  tip?: BrushTipOverlay | null;
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

function renderStrokePreview(
  g: CanvasRenderingContext2D,
  camera: Board['camera'],
  pixelRatio: number,
  stroke: ActiveStrokeOverlay | PresenceLiveStroke,
  elementContext: Board['elementContext'],
): void {
  const predicted = 'predicted' in stroke ? stroke.predicted : undefined;
  const points =
    predicted && predicted.length > 0 && stroke.points
      ? [...stroke.points, ...predicted]
      : stroke.points;
  if (!points || points.length === 0) return;

  const cam = camera.get();
  const zoom = cam.zoom;

  g.save();
  g.scale(pixelRatio, pixelRatio);
  g.translate(-cam.x * zoom, -cam.y * zoom);
  g.scale(zoom, zoom);

  const brush = elementContext
    ? elementContext.resolveBrush(stroke.brush ?? 'pen')
    : undefined;
  g.globalCompositeOperation = brush?.blend ?? 'source-over';
  g.fillStyle = stroke.color;

  const taper = brush?.strokeOptions.taper;
  const startTaper = typeof taper === 'object' && taper !== null ? taper.start : taper;
  const endTaper = typeof taper === 'object' && taper !== null ? taper.end : taper;

  const strokeOptions = {
    size: stroke.thickness,
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

  const outline = getStroke(points as number[][], strokeOptions);
  renderStrokeOutline(g, outline);
  g.restore();
}

/** Finite points of a lasso path, or `null` when fewer than two remain (BOARD-910). */
function lassoPath(points: readonly unknown[]): Point[] | null {
  const out = points.filter(
    (p): p is Point =>
      typeof p === 'object' &&
      p !== null &&
      Number.isFinite((p as Point).x) &&
      Number.isFinite((p as Point).y),
  );
  return out.length >= 2 ? out : null;
}

function isBoxBounds(b: unknown): b is BoxBounds {
  return (
    typeof b === 'object' &&
    b !== null &&
    Number.isFinite((b as BoxBounds).minX) &&
    Number.isFinite((b as BoxBounds).minY) &&
    Number.isFinite((b as BoxBounds).maxX) &&
    Number.isFinite((b as BoxBounds).maxY)
  );
}

interface CursorTrack {
  readonly id: string;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  color?: string;
  name?: string;
  lastActive: number;
}

/**
 * Manages rendering of the overlay canvas layer.
 *
 * @internal
 */
export class OverlayRenderer {
  private hoveredId: string | null = null;
  private cursors: readonly RemoteCursor[] = [];
  private readonly cursorTracks = new Map<string, CursorTrack>();
  private remoteSelections: readonly RemoteSelection[] = [];
  private remoteLiveStrokes: readonly PresenceLiveStroke[] = [];
  private presence: PresenceApi | null = null;
  private dropIndicator: Point | null = null;
  /** Screen position of a hovering pen (BOARD-911). */
  private penHover: Point | null = null;
  private lastRenderedWasEmpty = false;

  /** Hides the quick-connect handles, for example while an inline text editor is open. */
  quickConnectHidden = false;

  /**
   * Remote cursor inactivity timeout in milliseconds (BOARD-808).
   * Cursors without activity beyond this duration are hidden.
   */
  inactivityTimeoutMs: number = DEFAULT_CURSOR_INACTIVITY_MS;

  /**
   * Linear interpolation factor between 0 and 1 for smoothing cursor position updates (BOARD-808).
   */
  cursorLerpFactor: number = 0.35;

  constructor(private readonly board: Board) {}

  setHovered(id: string | null): boolean {
    if (this.hoveredId === id) return false;
    this.hoveredId = id;
    return true;
  }

  getHovered(): string | null {
    return this.hoveredId;
  }

  /**
   * Sets the screen position of a hovering pen, or `null` (BOARD-911). A freehand tool that
   * publishes a brush `tip` in its tool data gets the tip previewed there.
   */
  setPenHover(screen: Point | null): void {
    this.penHover = screen;
  }

  setPresence(presence: PresenceApi | null): void {
    this.presence = presence;
  }

  getPresence(): PresenceApi | null {
    return this.presence;
  }

  setCursors(cursors: readonly RemoteCursor[]): void {
    this.cursors = cursors;
    const now = Date.now();
    const activeIds = new Set<string>();
    for (const c of cursors) {
      activeIds.add(c.id);
      const existing = this.cursorTracks.get(c.id);
      if (existing) {
        if (existing.targetX !== c.x || existing.targetY !== c.y) {
          existing.targetX = c.x;
          existing.targetY = c.y;
          existing.lastActive = c.lastActive ?? now;
        } else if (c.lastActive !== undefined) {
          existing.lastActive = c.lastActive;
        }
        if (c.color !== undefined) existing.color = c.color;
        if (c.name !== undefined) existing.name = c.name;
      } else {
        this.cursorTracks.set(c.id, {
          id: c.id,
          currentX: c.x,
          currentY: c.y,
          targetX: c.x,
          targetY: c.y,
          color: c.color,
          name: c.name,
          lastActive: c.lastActive ?? now,
        });
      }
    }
    for (const id of this.cursorTracks.keys()) {
      if (!activeIds.has(id)) {
        this.cursorTracks.delete(id);
      }
    }
  }

  getCursors(): readonly RemoteCursor[] {
    const list: RemoteCursor[] = [];
    for (const track of this.cursorTracks.values()) {
      list.push({
        id: track.id,
        x: track.currentX,
        y: track.currentY,
        color: track.color,
        name: track.name,
        lastActive: track.lastActive,
      });
    }
    return list;
  }

  removeCursor(id: string): void {
    this.cursorTracks.delete(id);
    this.cursors = this.cursors.filter((c) => c.id !== id);
  }

  setRemoteSelections(selections: readonly RemoteSelection[]): void {
    this.remoteSelections = selections;
  }

  getRemoteSelections(): readonly RemoteSelection[] {
    return this.remoteSelections;
  }

  setRemoteLiveStrokes(strokes: readonly PresenceLiveStroke[]): void {
    this.remoteLiveStrokes = strokes;
  }

  getRemoteLiveStrokes(): readonly PresenceLiveStroke[] {
    return this.remoteLiveStrokes;
  }

  clearRemotePresence(): void {
    this.cursorTracks.clear();
    this.cursors = [];
    this.remoteSelections = [];
    this.remoteLiveStrokes = [];
    this.presence = null;
  }

  /**
   * Sets or clears the visual drop target indicator point in board coordinates (BOARD-608).
   *
   * @param point - Drop coordinate on the board, or `null` to clear.
   * @returns `true` if the indicator position changed.
   * @public
   */
  setDropIndicator(point: Point | null): boolean {
    if (this.dropIndicator === point) return false;
    if (
      this.dropIndicator &&
      point &&
      this.dropIndicator.x === point.x &&
      this.dropIndicator.y === point.y
    ) {
      return false;
    }
    this.dropIndicator = point ? { x: point.x, y: point.y } : null;
    return true;
  }

  /**
   * Returns the current drop target indicator point, or `null` if none.
   *
   * @public
   */
  getDropIndicator(): Point | null {
    return this.dropIndicator ? { ...this.dropIndicator } : null;
  }

  private syncPresenceCursors(now: number): void {
    const presence = this.presence ?? this.board.presence;
    if (!presence?.peers) return;
    const activeIds = new Set<string>();
    for (const [peerId, peerState] of presence.peers.entries()) {
      const cursor = peerState.cursor;
      if (!cursor) {
        this.cursorTracks.delete(peerId);
        continue;
      }
      activeIds.add(peerId);
      const color = peerState.user?.color;
      const name = peerState.user?.name;
      const lastActive = typeof peerState.lastActive === 'number' ? peerState.lastActive : now;

      const existing = this.cursorTracks.get(peerId);
      if (existing) {
        if (existing.targetX !== cursor.x || existing.targetY !== cursor.y) {
          existing.targetX = cursor.x;
          existing.targetY = cursor.y;
          existing.lastActive = lastActive;
        }
        if (color !== undefined) existing.color = color;
        if (name !== undefined) existing.name = name;
      } else {
        this.cursorTracks.set(peerId, {
          id: peerId,
          currentX: cursor.x,
          currentY: cursor.y,
          targetX: cursor.x,
          targetY: cursor.y,
          color,
          name,
          lastActive,
        });
      }
    }
    for (const id of this.cursorTracks.keys()) {
      if (this.cursors.length === 0 && !activeIds.has(id)) {
        this.cursorTracks.delete(id);
      }
    }
  }

  render(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    pixelRatio: number,
    now: number = Date.now(),
  ): OverlayRenderStats {
    const { board } = this;
    const camera = board.camera;
    const zoom = camera.get().zoom;

    // 1. Gather selection elements
    const selectedElements: Readonly<ElementRecord>[] = [];
    // Locked elements can be selected by clicking (BOARD-902) to unlock them from the toolbar;
    // they get a dashed outline and no handles.
    const lockedSelected: Readonly<ElementRecord>[] = [];
    for (const id of board.selection) {
      const el = board.getElement(id);
      if (el) {
        (el.locked ? lockedSelected : selectedElements).push(el);
      }
    }

    // 2. Gather tool data (selection brush, snap guides, active stroke, connector snap/preview)
    const toolData = board.toolData as ToolOverlayData | null;
    const brush = toolData?.brush ?? null;
    const selectionBrush = isBoxBounds(brush) ? brush : null;
    const lasso = Array.isArray(toolData?.lasso) ? lassoPath(toolData.lasso) : null;
    const guides = toolData?.guides ?? [];
    const activeStroke = toolData?.activeStroke ?? null;
    const hasActiveStroke = Boolean(
      activeStroke && activeStroke.points && activeStroke.points.length > 0,
    );
    const tip = toolData?.tip;
    const penTip =
      this.penHover && tip && typeof tip.thickness === 'number' && typeof tip.color === 'string'
        ? { screen: this.penHover, color: tip.color, thickness: tip.thickness }
        : null;
    const connectorSnap = toolData?.connectorSnap ?? null;
    const hasConnectorSnap = Boolean(connectorSnap && connectorSnap.point);
    const connectorPreview = toolData?.connectorPreview ?? null;
    const hasConnectorPreview = Boolean(
      connectorPreview &&
      ((connectorPreview.points && connectorPreview.points.length >= 2) ||
        (connectorPreview.bezier && connectorPreview.bezier.length === 4)),
    );

    // Element drop target under the dragged elements (BOARD-1208)
    const dropTargetEl =
      typeof toolData?.dropTargetId === 'string'
        ? (board.getElement(toolData.dropTargetId) ?? null)
        : null;

    // 3. Hovered element
    const hoveredEl =
      this.hoveredId && !board.selection.includes(this.hoveredId)
        ? board.getElement(this.hoveredId)
        : null;

    const theme = board.theme;
    const selectionStroke = theme?.selection?.stroke ?? SELECTION_COLOR;
    const selectionLineWidth = theme?.selection?.lineWidth ?? SELECTION_LINE_WIDTH;
    const brushFill = theme?.selection?.brushFill ?? BRUSH_FILL_COLOR;
    const brushStroke = theme?.selection?.brushStroke ?? BRUSH_STROKE_COLOR;
    const hoverStroke = theme?.selection?.hoverStroke ?? HOVER_STROKE_COLOR;
    const collabColors = theme?.collab ?? DEFAULT_COLLAB_COLORS;

    // 4. Remote collaborator selections (BOARD-808)
    const remoteSelections: RemoteSelection[] = [];
    if (this.remoteSelections.length > 0) {
      remoteSelections.push(...this.remoteSelections);
    } else {
      const presence = this.presence ?? this.board.presence;
      if (presence?.peers) {
        let peerIdx = 0;
        for (const [peerId, peerState] of presence.peers.entries()) {
          if (peerState.selection && peerState.selection.length > 0) {
            remoteSelections.push({
              peerId,
              elementIds: peerState.selection,
              color: peerState.user?.color ?? collabColors[peerIdx % collabColors.length] ?? SELECTION_COLOR,
              name: peerState.user?.name,
            });
          }
          peerIdx++;
        }
      }
    }

    let remoteSelectedCount = 0;
    for (const sel of remoteSelections) {
      for (const id of sel.elementIds) {
        const el = board.getElement(id);
        if (el && el.pageId === board.pages.current) {
          remoteSelectedCount++;
        }
      }
    }

    // 5. Remote ephemeral live strokes (BOARD-808)
    const remoteLiveStrokes: PresenceLiveStroke[] = [];
    if (this.remoteLiveStrokes.length > 0) {
      for (const stroke of this.remoteLiveStrokes) {
        if (!stroke.id || !board.getElement(stroke.id)) {
          remoteLiveStrokes.push(stroke);
        }
      }
    } else {
      const presence = this.presence ?? this.board.presence;
      if (typeof (presence as { getLiveStrokes?: unknown })?.getLiveStrokes === 'function') {
        const liveMap = (presence as unknown as { getLiveStrokes: (fn: (id: string) => boolean) => ReadonlyMap<string, PresenceLiveStroke> }).getLiveStrokes(
          (id: string) => Boolean(board.getElement(id)),
        );
        for (const stroke of liveMap.values()) {
          remoteLiveStrokes.push(stroke);
        }
      } else if (presence?.peers) {
        for (const peerState of presence.peers.values()) {
          const stroke = peerState.activeStroke;
          if (!stroke || !stroke.points || stroke.points.length === 0) continue;
          if (stroke.id && board.getElement(stroke.id)) continue;
          remoteLiveStrokes.push(stroke);
        }
      }
    }

    // 6. Remote cursors: smoothing, lerp, and inactivity timeout (BOARD-808)
    if (this.cursors.length === 0) {
      this.syncPresenceCursors(now);
    }

    let hasPendingCursorAnimation = false;
    let nextInactivityTimeoutMs: number | undefined;
    const visibleCursors: { x: number; y: number; color?: string; name?: string }[] = [];

    for (const track of this.cursorTracks.values()) {
      const elapsed = now - track.lastActive;
      if (elapsed > this.inactivityTimeoutMs) {
        continue;
      }

      const remaining = this.inactivityTimeoutMs - elapsed;
      if (remaining > 0) {
        if (nextInactivityTimeoutMs === undefined || remaining < nextInactivityTimeoutMs) {
          nextInactivityTimeoutMs = remaining;
        }
      }

      if (board.camera.reducedMotion) {
        track.currentX = track.targetX;
        track.currentY = track.targetY;
      } else {
        const dx = track.targetX - track.currentX;
        const dy = track.targetY - track.currentY;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.5) {
          track.currentX = track.targetX;
          track.currentY = track.targetY;
        } else {
          track.currentX += dx * this.cursorLerpFactor;
          track.currentY += dy * this.cursorLerpFactor;
          hasPendingCursorAnimation = true;
        }
      }

      visibleCursors.push({
        x: track.currentX,
        y: track.currentY,
        color: track.color,
        name: track.name,
      });
    }

    // Always reset transform and clear backing store
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hasContent =
      selectedElements.length > 0 ||
      lockedSelected.length > 0 ||
      selectionBrush !== null ||
      lasso !== null ||
      guides.length > 0 ||
      hoveredEl !== null ||
      dropTargetEl !== null ||
      visibleCursors.length > 0 ||
      hasActiveStroke ||
      remoteLiveStrokes.length > 0 ||
      remoteSelectedCount > 0 ||
      hasConnectorSnap ||
      hasConnectorPreview ||
      penTip !== null ||
      Boolean(this.dropIndicator);

    if (!hasContent) {
      return {
        rendered: false,
        selectedCount: 0,
        hasBrush: false,
        hasActiveStroke: false,
        hasDropIndicator: false,
        guidesCount: 0,
        hoveredId: null,
        remoteSelectedCount: 0,
        remoteCursorsCount: 0,
        remoteLiveStrokesCount: 0,
        hasPendingCursorAnimation: false,
        nextInactivityTimeoutMs: undefined,
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
      ctx.strokeStyle = hoverStroke;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }

    // --- A1. Element drop target highlight (BOARD-1208): tinted fill, solid thick outline ---
    if (dropTargetEl) {
      const center = camera.boardToScreen({
        x: dropTargetEl.x + dropTargetEl.w / 2,
        y: dropTargetEl.y + dropTargetEl.h / 2,
      });
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.translate(center.x, center.y);
      if (dropTargetEl.rotation) {
        ctx.rotate((dropTargetEl.rotation * Math.PI) / 180);
      }
      const sw = dropTargetEl.w * zoom;
      const sh = dropTargetEl.h * zoom;
      ctx.fillStyle = brushFill;
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
      ctx.strokeStyle = selectionStroke;
      ctx.lineWidth = selectionLineWidth * 2;
      ctx.setLineDash([]);
      ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }

    // --- A2. Locked selected elements: dashed outline, no handles ---
    for (const el of lockedSelected) {
      const center = camera.boardToScreen({ x: el.x + el.w / 2, y: el.y + el.h / 2 });
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.translate(center.x, center.y);
      if (el.rotation) {
        ctx.rotate((el.rotation * Math.PI) / 180);
      }
      const sw = el.w * zoom;
      const sh = el.h * zoom;
      ctx.strokeStyle = selectionStroke;
      ctx.lineWidth = selectionLineWidth;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    }

    // --- A3. Remote Collaborator Selections (BOARD-808) ---
    for (const sel of remoteSelections) {
      const color = sel.color ?? SELECTION_COLOR;
      for (let i = 0; i < sel.elementIds.length; i++) {
        const id = sel.elementIds[i]!;
        const el = board.getElement(id);
        if (!el || el.pageId !== board.pages.current) continue;

        if (el.type === 'connector') {
          const props = el.props as {
            readonly start?: { readonly x: number; readonly y: number };
            readonly end?: { readonly x: number; readonly y: number };
          };
          const start = props.start ?? { x: 0, y: 0 };
          const end = props.end ?? { x: el.w, y: el.h };
          const startWorld = { x: el.x + start.x, y: el.y + start.y };
          const endWorld = { x: el.x + end.x, y: el.y + end.y };
          const sStart = camera.boardToScreen(startWorld);
          const sEnd = camera.boardToScreen(endWorld);

          ctx.save();
          ctx.scale(pixelRatio, pixelRatio);
          ctx.beginPath();
          ctx.moveTo(sStart.x, sStart.y);
          ctx.lineTo(sEnd.x, sEnd.y);
          ctx.strokeStyle = color;
          ctx.lineWidth = selectionLineWidth;
          ctx.stroke();
          ctx.restore();
        } else {
          const center = camera.boardToScreen({
            x: el.x + el.w / 2,
            y: el.y + el.h / 2,
          });
          const sw = el.w * zoom;
          const sh = el.h * zoom;

          ctx.save();
          ctx.scale(pixelRatio, pixelRatio);
          ctx.translate(center.x, center.y);
          if (el.rotation) {
            ctx.rotate((el.rotation * Math.PI) / 180);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = selectionLineWidth;
          ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);

          // Name badge on the first selected element
          if (sel.name && i === 0) {
            ctx.font = '10px sans-serif';
            const textW = ctx.measureText(sel.name).width;
            const badgeH = 14;
            const badgeW = textW + 6;
            const badgeX = -sw / 2;
            const badgeY = -sh / 2 - badgeH;
            ctx.fillStyle = color;
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(sel.name, badgeX + 3, badgeY + 10);
          }
          ctx.restore();
        }
      }
    }

    // --- B. Selection Frame and Handles ---
    const loneLine =
      selectedElements.length === 1 && selectedElements[0]!.type === 'line'
        ? selectedElements[0]!
        : null;
    const linePoints = loneLine
      ? (loneLine.props as { readonly points?: readonly { x: number; y: number }[] }).points
      : undefined;
    if (loneLine && Array.isArray(linePoints) && linePoints.length > 0) {
      // Lines (BOARD-1106): the path, a handle on every point, and an insertion handle in the
      // middle of every segment long enough to hold one.
      const route = linePoints.map((p) => camera.boardToScreen(localToBoard(loneLine, p)));
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.beginPath();
      ctx.moveTo(route[0]!.x, route[0]!.y);
      for (let i = 1; i < route.length; i++) ctx.lineTo(route[i]!.x, route[i]!.y);
      ctx.strokeStyle = selectionStroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      for (const mid of midpointHandles(route, LINE_INSERT_MIN_SEGMENT_PX)) {
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, LINE_INSERT_HANDLE_RADIUS_PX, 0, Math.PI * 2);
        ctx.fillStyle = selectionStroke;
        ctx.globalAlpha = 0.45;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      for (const point of route) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, LINE_POINT_HANDLE_RADIUS_PX, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = selectionStroke;
        ctx.lineWidth = selectionLineWidth;
        ctx.stroke();
      }
      ctx.restore();
    } else if (selectedElements.length === 1 && selectedElements[0]!.type === 'connector') {
      const el = selectedElements[0]!;
      const props = el.props as {
        readonly start?: { readonly x: number; readonly y: number };
        readonly end?: { readonly x: number; readonly y: number };
        readonly startBindingId?: string | null;
        readonly endBindingId?: string | null;
      };
      const start = props.start ?? { x: 0, y: 0 };
      const end = props.end ?? { x: el.w, y: el.h };
      const startWorld = { x: el.x + start.x, y: el.y + start.y };
      const endWorld = { x: el.x + end.x, y: el.y + end.y };
      const sStart = camera.boardToScreen(startWorld);
      const sEnd = camera.boardToScreen(endWorld);

      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);

      // Subtle highlight along the routed path (its polyline geometry), or start to end
      const geometry = board.elements.get(el.type)?.geometry?.(el as never);
      const route =
        geometry?.kind === 'polyline' && geometry.points.length >= 2
          ? geometry.points.map((p) => camera.boardToScreen({ x: el.x + p.x, y: el.y + p.y }))
          : [sStart, sEnd];
      ctx.beginPath();
      ctx.moveTo(route[0]!.x, route[0]!.y);
      // Elbow corners are rounded like the connector itself (12 board units).
      const cornerRadius = (props as { style?: string }).style === 'elbow' ? 12 * zoom : 0;
      for (let i = 1; i < route.length - 1; i++) {
        const prev = route[i - 1]!;
        const corner = route[i]!;
        const next = route[i + 1]!;
        const r = Math.min(
          cornerRadius,
          Math.hypot(corner.x - prev.x, corner.y - prev.y) / 2,
          Math.hypot(next.x - corner.x, next.y - corner.y) / 2,
        );
        if (r > 0.5) ctx.arcTo(corner.x, corner.y, next.x, next.y, r);
        else ctx.lineTo(corner.x, corner.y);
      }
      ctx.lineTo(route[route.length - 1]!.x, route[route.length - 1]!.y);
      ctx.strokeStyle = selectionStroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Elbow connectors: a pill on each draggable segment
      if ((props as { style?: string }).style === 'elbow') {
        for (const handle of segmentHandles(route, SEGMENT_HANDLE_LENGTH_PX * 2)) {
          const long = SEGMENT_HANDLE_LENGTH_PX;
          const short = SEGMENT_HANDLE_THICKNESS_PX;
          const w = handle.axis === 'y' ? long : short;
          const h = handle.axis === 'y' ? short : long;
          ctx.beginPath();
          ctx.roundRect?.(handle.x - w / 2, handle.y - h / 2, w, h, short / 2);
          ctx.fillStyle = selectionStroke;
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Circular endpoint handles (radius 5px, white fill, 2px selectionStroke border)
      const endpoints = [
        { screen: sStart, bound: Boolean(props.startBindingId) },
        { screen: sEnd, bound: Boolean(props.endBindingId) },
      ];
      for (const ep of endpoints) {
        ctx.beginPath();
        ctx.arc(ep.screen.x, ep.screen.y, CONNECTOR_HANDLE_RADIUS_PX, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = selectionStroke;
        ctx.lineWidth = selectionLineWidth;
        ctx.stroke();

        // Filled inner dot (radius 2.5px) when bound
        if (ep.bound) {
          ctx.beginPath();
          ctx.arc(ep.screen.x, ep.screen.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = selectionStroke;
          ctx.fill();
        }
      }
      ctx.restore();
    } else if (selectedElements.length > 0) {
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
        ctx.strokeStyle = selectionStroke;
        ctx.lineWidth = selectionLineWidth;
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
            ctx.strokeStyle = selectionStroke;
            ctx.lineWidth = selectionLineWidth;
            ctx.stroke();
          } else {
            const hs = HANDLE_SIZE_PX;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(s.x - hs / 2, s.y - hs / 2, hs, hs);
            ctx.strokeStyle = selectionStroke;
            ctx.lineWidth = selectionLineWidth;
            ctx.strokeRect(s.x - hs / 2, s.y - hs / 2, hs, hs);
          }
        }

        // Quick-connect handles: one dot outside each side of a lone connectable element, shown
        // while the select tool is idle.
        const lone = selectedElements.length === 1 ? selectedElements[0]! : null;
        if (
          lone &&
          lockedSelected.length === 0 &&
          !this.quickConnectHidden &&
          !board.readOnly &&
          board.tool === 'select' &&
          board.toolState === 'idle' &&
          board.elements.get(lone.type)?.connectable
        ) {
          const hover = toolData?.quickConnectHover ?? null;
          for (const pt of quickConnectHandles(frame, QUICK_CONNECT_OFFSET_PX / zoom)) {
            const s = camera.boardToScreen(pt);
            ctx.beginPath();
            ctx.arc(
              s.x,
              s.y,
              pt.side === hover ? QUICK_CONNECT_RADIUS_PX + 2 : QUICK_CONNECT_RADIUS_PX,
              0,
              Math.PI * 2,
            );
            ctx.fillStyle = selectionStroke;
            ctx.globalAlpha = pt.side === hover ? 1 : 0.55;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // --- C. Selection Area Brush ---
    if (selectionBrush) {
      const p1 = camera.boardToScreen({ x: selectionBrush.minX, y: selectionBrush.minY });
      const p2 = camera.boardToScreen({ x: selectionBrush.maxX, y: selectionBrush.maxY });
      const bx = Math.min(p1.x, p2.x);
      const by = Math.min(p1.y, p2.y);
      const bw = Math.abs(p2.x - p1.x);
      const bh = Math.abs(p2.y - p1.y);

      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.fillStyle = brushFill;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = brushStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
    }

    // --- C2. Lasso (BOARD-910): filled like the selection box, dashed outline ---
    if (lasso) {
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.beginPath();
      lasso.forEach((p, i) => {
        const s = camera.boardToScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.fillStyle = brushFill;
      ctx.fill('evenodd');
      ctx.strokeStyle = brushStroke;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
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

    // --- E. Presence Cursors (BOARD-808) ---
    if (visibleCursors.length > 0) {
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      visibleCursors.forEach((cursor, cursorIdx) => {
        const s = camera.boardToScreen({ x: cursor.x, y: cursor.y });
        const color = cursor.color ?? collabColors[cursorIdx % collabColors.length] ?? '#2F6FDB';

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
      });
      ctx.restore();
    }

    // --- F. Active Freehand Stroke Preview (BOARD-1002) ---
    if (activeStroke && activeStroke.points && activeStroke.points.length > 0) {
      renderStrokePreview(ctx, camera, pixelRatio, activeStroke, board.elementContext);
    }

    // --- F1. Brush Tip Under a Hovering Pen (BOARD-911) ---
    if (penTip) {
      const radius = Math.max(1.5, (penTip.thickness * zoom) / 2);
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.beginPath();
      ctx.arc(penTip.screen.x, penTip.screen.y, radius, 0, Math.PI * 2);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = penTip.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = selectionStroke;
      ctx.stroke();
      ctx.restore();
    }

    // --- F2. Remote Ephemeral Live Strokes (BOARD-808) ---
    for (const stroke of remoteLiveStrokes) {
      if (stroke.points && stroke.points.length > 0) {
        renderStrokePreview(ctx, camera, pixelRatio, stroke, board.elementContext);
      }
    }

    // --- G. Active Connector Drag Preview (BOARD-1101) ---
    if (hasConnectorPreview && connectorPreview) {
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.strokeStyle = connectorPreview.color ?? selectionStroke;
      ctx.lineWidth = (connectorPreview.strokeWidth ?? 2) * zoom;
      const dash = connectorPreview.dash ?? 'solid';
      if (dash === 'dashed') {
        ctx.setLineDash([8 * zoom, 6 * zoom]);
      } else if (dash === 'dotted') {
        ctx.setLineDash([2 * zoom, 4 * zoom]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      if (
        connectorPreview.style === 'curved' &&
        connectorPreview.bezier &&
        connectorPreview.bezier.length === 4
      ) {
        const p0 = camera.boardToScreen(connectorPreview.bezier[0]);
        const p1 = camera.boardToScreen(connectorPreview.bezier[1]);
        const p2 = camera.boardToScreen(connectorPreview.bezier[2]);
        const p3 = camera.boardToScreen(connectorPreview.bezier[3]);
        ctx.moveTo(p0.x, p0.y);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      } else if (connectorPreview.points && connectorPreview.points.length >= 2) {
        const first = camera.boardToScreen(connectorPreview.points[0]!);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < connectorPreview.points.length; i++) {
          const pt = camera.boardToScreen(connectorPreview.points[i]!);
          ctx.lineTo(pt.x, pt.y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // --- H. Connector Anchor Snap Indicators (BOARD-1101d) ---
    if (hasConnectorSnap && connectorSnap) {
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);

      // Candidate anchor points on target element (radius 4px, white fill, selectionStroke border)
      if (connectorSnap.candidates) {
        for (const cand of connectorSnap.candidates) {
          const sc = camera.boardToScreen(cand);
          ctx.beginPath();
          ctx.arc(sc.x, sc.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = selectionStroke;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Snapped point: outer halo (radius 11px) + emphasized circle (radius 6px)
      const sp = camera.boardToScreen(connectorSnap.point);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(47, 111, 219, 0.25)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = selectionStroke;
      ctx.fill();

      ctx.restore();
    }

    // --- I. Drop Target Indicator (BOARD-608) ---
    if (this.dropIndicator) {
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      const sp = camera.boardToScreen(this.dropIndicator);

      // Outer subtle halo / target circle with dashed border
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(47, 111, 219, 0.12)';
      ctx.fill();
      ctx.strokeStyle = selectionStroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();

      // Inner center dot
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = selectionStroke;
      ctx.fill();

      ctx.restore();
    }

    return {
      rendered: true,
      selectedCount: selectedElements.length,
      hasBrush: selectionBrush !== null || lasso !== null,
      hasActiveStroke,
      hasDropIndicator: Boolean(this.dropIndicator),
      dropTargetId: dropTargetEl?.id ?? null,
      guidesCount: guides.length,
      hoveredId: this.hoveredId,
      remoteSelectedCount,
      remoteCursorsCount: visibleCursors.length,
      remoteLiveStrokesCount: remoteLiveStrokes.length,
      hasPendingCursorAnimation,
      nextInactivityTimeoutMs,
    };
  }
}
