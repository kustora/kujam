/**
 * Canvas rich text layout engine, line wrapping, list formatting, and auto-font scaling (BOARD-1003a, BOARD-1001).
 *
 * @packageDocumentation
 */

import type { ElementCanvasContext } from '@kujam/core';
import type { RichText } from './model.js';

/**
 * A measured span of text with uniform styling.
 *
 * @public
 */
export interface TextRun {
  readonly text: string;
  readonly width: number;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly link?: string;
}

/**
 * List marker bullet or number.
 *
 * @public
 */
export interface ListMarker {
  readonly text: string;
  readonly x: number;
  readonly width: number;
}

/**
 * A single laid-out visual line of text on canvas.
 *
 * @public
 */
export interface TextLayoutLine {
  readonly runs: readonly TextRun[];
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly marker?: ListMarker;
}

/**
 * Complete result of measuring and wrapping a rich text document.
 *
 * @public
 */
export interface TextLayout {
  readonly lines: readonly TextLayoutLine[];
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly truncated?: boolean;
}

/**
 * Options for configuring text layout.
 *
 * @public
 */
export interface TextLayoutOptions {
  /** Maximum width in board units; text wraps when exceeding this width. */
  readonly maxWidth?: number;
  /** Box width for horizontal alignment (start, center, end). Defaults to maxWidth. */
  readonly boxWidth?: number;
  /** Font size in pixels. */
  readonly fontSize: number;
  /** Primary font family. */
  readonly fontFamily?: string;
  /** Line height multiplier, defaults to 1.35. */
  readonly lineHeightMultiplier?: number;
  /** Horizontal alignment: 'start' (left in LTR), 'center', or 'end' (right in LTR). */
  readonly align?: 'start' | 'center' | 'end';
  /** Indent distance per list nesting level in board units, defaults to 20. */
  readonly listIndentPx?: number;
  /** Optional custom measurement function. */
  readonly measure?: (text: string, font: string, bold?: boolean, italic?: boolean) => number;
}

/**
 * Options for sticky note auto-shrinking font calculation (BOARD-1001).
 *
 * @public
 */
export interface StickyLayoutOptions {
  readonly boxW: number;
  readonly boxH: number;
  readonly padding?: number;
  readonly baseFontSize?: number;
  readonly minFontSize?: number;
  readonly fontFamily?: string;
  readonly align?: 'start' | 'center' | 'end';
  readonly measure?: (text: string, font: string, bold?: boolean, italic?: boolean) => number;
}

/**
 * Options for rendering layout onto a 2D canvas context.
 *
 * @public
 */
export interface DrawRichTextOptions {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly linkColor?: string;
  readonly fontFamily?: string;
}

/**
 * Constructs a standard CSS font string.
 *
 * @internal
 */
export function formatFont(
  fontSize: number,
  fontFamily = 'Plus Jakarta Sans, -apple-system, BlinkMacSystemFont, sans-serif',
  bold = false,
  italic = false,
): string {
  const parts: string[] = [];
  if (italic) parts.push('italic');
  if (bold) parts.push('bold');
  parts.push(`${fontSize}px`);
  parts.push(fontFamily);
  return parts.join(' ');
}

/**
 * Default fallback measurement heuristic when no Canvas context is available.
 */
function defaultMeasure(text: string, fontSize: number, bold = false): number {
  const factor = bold ? 0.62 : 0.55;
  return Math.round(text.length * fontSize * factor * 10) / 10;
}

/**
 * Creates a measurement helper using a canvas context or fallback.
 */
export function createMeasurer(
  g?: ElementCanvasContext | null,
  fontFamily?: string,
  customMeasure?: TextLayoutOptions['measure'],
): (text: string, fontSize: number, bold?: boolean, italic?: boolean) => number {
  if (customMeasure) {
    return (text, fontSize, bold, italic) => {
      const font = formatFont(fontSize, fontFamily, bold, italic);
      return customMeasure(text, font, bold, italic);
    };
  }

  if (g && typeof g.measureText === 'function') {
    return (text, fontSize, bold, italic) => {
      if (!text) return 0;
      g.font = formatFont(fontSize, fontFamily, bold, italic);
      const measured = g.measureText(text)?.width;
      if (typeof measured === 'number' && measured > 0) return measured;
      return defaultMeasure(text, fontSize, bold);
    };
  }

  return (text, fontSize, bold) => defaultMeasure(text, fontSize, bold);
}

interface RawLine {
  ops: Array<{ text: string; bold?: boolean; italic?: boolean; link?: string }>;
  list?: 'bullet' | 'ordered';
  indent: number;
}

/**
 * Splits canonical rich text delta into logical paragraph lines based on newline characters.
 */
function splitDeltaIntoLines(delta: RichText): RawLine[] {
  const lines: RawLine[] = [];
  let currentOps: RawLine['ops'] = [];

  for (const op of delta) {
    const parts = op.insert.split(/(\n)/);
    for (const part of parts) {
      if (part === '\n') {
        lines.push({
          ops: currentOps,
          list: op.attributes?.list,
          indent: op.attributes?.indent ?? (op.attributes?.list ? 1 : 0),
        });
        currentOps = [];
      } else if (part.length > 0) {
        currentOps.push({
          text: part,
          bold: op.attributes?.bold,
          italic: op.attributes?.italic,
          link: op.attributes?.link,
        });
      }
    }
  }

  if (currentOps.length > 0) {
    lines.push({ ops: currentOps, indent: 0 });
  }

  return lines;
}

/**
 * Measures and wraps rich text ops into visual lines for Canvas rendering (BOARD-1003a).
 *
 * @public
 */
export function layoutRichText(
  delta: RichText,
  options: TextLayoutOptions,
  measurer?: ReturnType<typeof createMeasurer>,
): TextLayout {
  const {
    maxWidth,
    fontSize,
    fontFamily,
    lineHeightMultiplier = 1.35,
    align = 'start',
    listIndentPx = 20,
  } = options;

  const measure = measurer ?? createMeasurer(null, fontFamily, options.measure);
  const lineHeight = Math.round(fontSize * lineHeightMultiplier);
  const rawLines = splitDeltaIntoLines(delta);

  const visualLines: TextLayoutLine[] = [];
  const listCounters: number[] = [];
  let currentY = 0;
  let maxCalculatedWidth = 0;

  for (const rawLine of rawLines) {
    const isList = Boolean(rawLine.list);
    const indentLevel = Math.max(0, rawLine.indent - 1);
    const indentOffset = indentLevel * listIndentPx;

    let marker: ListMarker | undefined;
    let markerWidth = 0;

    if (isList) {
      listCounters.length = indentLevel + 1;
      listCounters[indentLevel] = (listCounters[indentLevel] ?? 0) + 1;
      const markerText = rawLine.list === 'ordered' ? `${listCounters[indentLevel]}.` : '•';
      markerWidth = measure(markerText, fontSize, false, false) + 8;
      marker = {
        text: markerText,
        x: indentOffset,
        width: markerWidth,
      };
    } else {
      listCounters.length = 0;
    }

    const contentIndent = isList ? indentOffset + markerWidth : 0;
    const availableWidth = maxWidth !== undefined ? Math.max(20, maxWidth - contentIndent) : Infinity;

    // Handle empty line (paragraph spacer)
    if (rawLine.ops.length === 0) {
      visualLines.push({
        runs: [],
        width: 0,
        height: lineHeight,
        x: contentIndent,
        y: currentY,
        marker,
      });
      currentY += lineHeight;
      continue;
    }

    // Wrap words across runs for this line
    interface WordToken {
      text: string;
      bold?: boolean;
      italic?: boolean;
      link?: string;
      width: number;
      isWhitespace: boolean;
    }

    const tokens: WordToken[] = [];
    for (const op of rawLine.ops) {
      // Split into words preserving whitespace
      const chunks = op.text.split(/(\s+)/);
      for (const chunk of chunks) {
        if (!chunk) continue;
        tokens.push({
          text: chunk,
          bold: op.bold,
          italic: op.italic,
          link: op.link,
          width: measure(chunk, fontSize, op.bold, op.italic),
          isWhitespace: /^\s+$/.test(chunk),
        });
      }
    }

    let currentLineTokens: WordToken[] = [];
    let currentLineWidth = 0;
    let isFirstSubLine = true;

    const commitSubLine = () => {
      // Strip trailing whitespace tokens from width
      while (currentLineTokens.length > 0 && currentLineTokens[currentLineTokens.length - 1]?.isWhitespace) {
        currentLineTokens.pop();
      }

      if (currentLineTokens.length === 0 && !isFirstSubLine) {
        return;
      }

      // Merge adjacent tokens with identical styling into final runs
      const runs: TextRun[] = [];
      let totalLineWidth = 0;

      for (const t of currentLineTokens) {
        const last = runs[runs.length - 1];
        if (last && last.bold === t.bold && last.italic === t.italic && last.link === t.link) {
          runs[runs.length - 1] = {
            text: last.text + t.text,
            width: last.width + t.width,
            bold: last.bold,
            italic: last.italic,
            link: last.link,
          };
        } else {
          runs.push({
            text: t.text,
            width: t.width,
            bold: t.bold,
            italic: t.italic,
            link: t.link,
          });
        }
        totalLineWidth += t.width;
      }

      let lineX = contentIndent;
      const targetWidth = options.boxWidth ?? maxWidth;
      if (targetWidth !== undefined && !isList) {
        if (align === 'center') {
          lineX = Math.max(0, (targetWidth - totalLineWidth) / 2);
        } else if (align === 'end') {
          lineX = Math.max(0, targetWidth - totalLineWidth);
        }
      }

      visualLines.push({
        runs,
        width: totalLineWidth,
        height: lineHeight,
        x: lineX,
        y: currentY,
        marker: isFirstSubLine ? marker : undefined,
      });

      maxCalculatedWidth = Math.max(maxCalculatedWidth, lineX + totalLineWidth);
      currentY += lineHeight;
      currentLineTokens = [];
      currentLineWidth = 0;
      isFirstSubLine = false;
    };

    for (const token of tokens) {
      if (currentLineWidth + token.width <= availableWidth || currentLineTokens.length === 0) {
        currentLineTokens.push(token);
        currentLineWidth += token.width;
      } else {
        // If word is alone and wider than available width, break word into characters
        if (currentLineTokens.length === 0 && token.width > availableWidth) {
          let charBuf = '';
          let charBufWidth = 0;
          for (const char of token.text) {
            const charW = measure(char, fontSize, token.bold, token.italic);
            if (charBufWidth + charW > availableWidth && charBuf.length > 0) {
              currentLineTokens.push({
                text: charBuf,
                bold: token.bold,
                italic: token.italic,
                link: token.link,
                width: charBufWidth,
                isWhitespace: false,
              });
              commitSubLine();
              charBuf = char;
              charBufWidth = charW;
            } else {
              charBuf += char;
              charBufWidth += charW;
            }
          }
          if (charBuf.length > 0) {
            currentLineTokens.push({
              text: charBuf,
              bold: token.bold,
              italic: token.italic,
              link: token.link,
              width: charBufWidth,
              isWhitespace: false,
            });
            currentLineWidth = charBufWidth;
          }
        } else {
          commitSubLine();
          if (!token.isWhitespace) {
            currentLineTokens.push(token);
            currentLineWidth = token.width;
          }
        }
      }
    }

    if (currentLineTokens.length > 0 || isFirstSubLine) {
      commitSubLine();
    }
  }

  return {
    lines: visualLines,
    width: maxWidth !== undefined ? maxWidth : maxCalculatedWidth,
    height: Math.max(lineHeight, currentY),
    fontSize,
    lineHeight,
  };
}

/**
 * Computes auto-shrinking font size and fits rich text to a sticky note box (BOARD-1001).
 *
 * Starts from `baseFontSize` (default 24px) down to `minFontSize` (default 12px) until all
 * lines fit within `boxH - padding * 2`. If still overflowing at `minFontSize`, clips lines
 * and appends an ellipsis (`…`) to the final visible line.
 *
 * @public
 */
export function layoutStickyText(
  delta: RichText,
  options: StickyLayoutOptions,
  measurer?: ReturnType<typeof createMeasurer>,
): TextLayout {
  const {
    boxW,
    boxH,
    padding = 16,
    baseFontSize = 24,
    minFontSize = 12,
    fontFamily,
    align = 'start',
  } = options;

  const measure = measurer ?? createMeasurer(null, fontFamily, options.measure);
  const availW = Math.max(40, boxW - padding * 2);
  const availH = Math.max(30, boxH - padding * 2);

  let bestLayout: TextLayout | undefined;

  for (let size = baseFontSize; size >= minFontSize; size -= 2) {
    const layout = layoutRichText(
      delta,
      {
        maxWidth: availW,
        fontSize: size,
        fontFamily,
        align,
      },
      measure,
    );

    if (layout.height <= availH) {
      return layout;
    }
    bestLayout = layout;
  }

  // If even minFontSize overflows, truncate lines to fit available height
  if (!bestLayout) {
    bestLayout = layoutRichText(
      delta,
      {
        maxWidth: availW,
        fontSize: minFontSize,
        fontFamily,
        align,
      },
      measure,
    );
  }

  const maxFittingLines = Math.max(1, Math.floor(availH / bestLayout.lineHeight));
  if (bestLayout.lines.length <= maxFittingLines) {
    return bestLayout;
  }

  const truncatedLines = [...bestLayout.lines.slice(0, maxFittingLines)];
  const lastLine = truncatedLines[truncatedLines.length - 1];

  if (lastLine && lastLine.runs.length > 0) {
    const runs = [...lastLine.runs];
    const lastRun = runs[runs.length - 1]!;
    const ellipsisText = '…';
    const ellipsisWidth = measure(ellipsisText, bestLayout.fontSize, lastRun.bold, lastRun.italic);

    // Shorten text to fit ellipsis
    let newText = lastRun.text;
    while (newText.length > 0 && lastRun.width - measure(newText, bestLayout.fontSize, lastRun.bold) + ellipsisWidth > availW) {
      newText = newText.slice(0, -1);
    }
    if (newText.length === 0) newText = lastRun.text.slice(0, Math.max(1, lastRun.text.length - 2));

    runs[runs.length - 1] = {
      ...lastRun,
      text: newText + ellipsisText,
      width: measure(newText + ellipsisText, bestLayout.fontSize, lastRun.bold, lastRun.italic),
    };

    truncatedLines[truncatedLines.length - 1] = {
      ...lastLine,
      runs,
    };
  }

  return {
    lines: truncatedLines,
    width: availW,
    height: truncatedLines.length * bestLayout.lineHeight,
    fontSize: bestLayout.fontSize,
    lineHeight: bestLayout.lineHeight,
    truncated: true,
  };
}

/**
 * Draws a pre-computed rich text layout on Canvas 2D (BOARD-1003a, BOARD-1001).
 *
 * @public
 */
export function drawRichText(
  g: ElementCanvasContext,
  layout: TextLayout,
  options: DrawRichTextOptions,
): void {
  if (layout.lines.length === 0) return;

  const { x, y, color, linkColor = '#2F6FDB', fontFamily } = options;

  g.save();
  g.textBaseline = 'top';
  g.textAlign = 'left';

  for (const line of layout.lines) {
    const lineY = y + line.y;

    if (line.marker) {
      g.fillStyle = color;
      g.font = formatFont(layout.fontSize, fontFamily, false, false);
      g.fillText(line.marker.text, x + line.marker.x, lineY);
    }

    let runX = x + line.x;
    for (const run of line.runs) {
      g.font = formatFont(layout.fontSize, fontFamily, run.bold, run.italic);
      g.fillStyle = run.link ? linkColor : color;
      g.fillText(run.text, runX, lineY);

      if (run.link) {
        // Draw delicate underline beneath link text
        const underlineY = Math.round(lineY + layout.fontSize * 1.15);
        g.fillRect(runX, underlineY, run.width, 1.5);
      }

      runX += run.width;
    }
  }

  g.restore();
}
