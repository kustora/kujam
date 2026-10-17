/**
 * Shared Canvas drawing helpers for built-in elements.
 *
 * @internal
 */
import type { ElementCanvasContext, Geometry } from '@kujam/core';

/** Traces a geometry path on the context (without fill/stroke). */
export function traceGeometry(g: ElementCanvasContext, geometry: Geometry): void {
  g.beginPath();
  switch (geometry.kind) {
    case 'rect':
      g.rect(geometry.x, geometry.y, geometry.w, geometry.h);
      return;
    case 'ellipse':
      g.ellipse(
        geometry.x + geometry.w / 2,
        geometry.y + geometry.h / 2,
        geometry.w / 2,
        geometry.h / 2,
        0,
        0,
        Math.PI * 2,
      );
      return;
    case 'polygon':
    case 'polyline':
    case 'path':
      geometry.points.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
      if (geometry.kind === 'polygon' || (geometry.kind === 'path' && geometry.closed)) {
        g.closePath();
      }
      return;
  }
}

/** Traces a rounded rectangle. */
export function traceRoundedRect(
  g: ElementCanvasContext,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  g.beginPath();
  g.moveTo(r, 0);
  g.lineTo(w - r, 0);
  g.quadraticCurveTo(w, 0, w, r);
  g.lineTo(w, h - r);
  g.quadraticCurveTo(w, h, w - r, h);
  g.lineTo(r, h);
  g.quadraticCurveTo(0, h, 0, h - r);
  g.lineTo(0, r);
  g.quadraticCurveTo(0, 0, r, 0);
  g.closePath();
}

/** Options for {@link drawPlainText}. */
export interface PlainTextOptions {
  readonly x: number;
  readonly y: number;
  readonly maxWidth: number;
  readonly fontSize: number;
  readonly color: string;
  readonly align: 'start' | 'center' | 'end';
}

// TODO(BOARD-1003a): replace with the rich text renderer (wrap, measure, lists, bold/italic).
/** Draws plain text per `\n`-separated line, without wrapping. */
export function drawPlainText(g: ElementCanvasContext, text: string, o: PlainTextOptions): void {
  if (!text) return;
  g.fillStyle = o.color;
  g.font = `${o.fontSize}px sans-serif`;
  g.textBaseline = 'top';
  g.textAlign = o.align;
  const x =
    o.align === 'center' ? o.x + o.maxWidth / 2 : o.align === 'end' ? o.x + o.maxWidth : o.x;
  const lineHeight = o.fontSize * 1.3;
  text.split('\n').forEach((line, i) => g.fillText(line, x, o.y + i * lineHeight, o.maxWidth));
}
