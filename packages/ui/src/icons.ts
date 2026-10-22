/**
 * Line icons for the UI (BOARD-1401): 24 × 24 box, stroke 2, round caps and joins, drawn in
 * `currentColor` (DESIGN.md Icons). Drawn for this package in the Lucide style; no third-party
 * artwork is bundled.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Shapes per icon; each entry is one SVG child element with its attributes. */
type IconShape = readonly [tag: string, attributes: Readonly<Record<string, string>>];

const IDENTITY = '';
/** Mirrors an icon horizontally within its 24 × 24 box. */
const MIRROR = 'matrix(-1 0 0 1 24 0)';

/** Line-with-arrowhead icons (`<prefix>None`, `<prefix>Arrow`, …), pointing right before `transform`. */
function arrowheads(prefix: 'start' | 'end', transform: string): Record<string, IconShape[]> {
  const t = (attributes: Record<string, string>): Record<string, string> =>
    transform ? { ...attributes, transform } : attributes;
  const line = (to: number): IconShape => [
    'line',
    t({ x1: '3', y1: '12', x2: String(to), y2: '12' }),
  ];
  return {
    [`${prefix}ArrowNone`]: [line(21)],
    [`${prefix}ArrowArrow`]: [line(20), ['path', t({ d: 'M15 7l5 5-5 5' })]],
    [`${prefix}ArrowTriangle`]: [
      line(15),
      ['path', t({ d: 'M15 7l6 5-6 5z', fill: 'currentColor' })],
    ],
    [`${prefix}ArrowDot`]: [
      line(15),
      ['circle', t({ cx: '18', cy: '12', r: '3', fill: 'currentColor' })],
    ],
    [`${prefix}ArrowDiamond`]: [
      line(13),
      ['path', t({ d: 'M13 12l4-4 4 4-4 4z', fill: 'currentColor' })],
    ],
  };
}

const ICONS: Readonly<Record<string, readonly IconShape[]>> = {
  select: [['path', { d: 'M5 3l14 7-6 2-2 6z' }]],
  hand: [
    ['path', { d: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12' }],
    ['path', { d: 'M11 11.5V4.5a1.5 1.5 0 0 1 3 0V12' }],
    [
      'path',
      {
        d: 'M14 11.5V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.3 15a1.5 1.5 0 0 1 2.4-1.8L8 15.5',
      },
    ],
  ],
  sticky: [
    ['path', { d: 'M4 4h16v10l-6 6H4z' }],
    ['path', { d: 'M14 20v-6h6' }],
  ],
  draw: [
    ['path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z' }],
    ['path', { d: 'M14.5 5.5l3 3' }],
  ],
  shape: [
    ['rect', { x: '3', y: '3', width: '10', height: '10', rx: '1' }],
    ['circle', { cx: '15.5', cy: '15.5', r: '5.5' }],
  ],
  rectangle: [['rect', { x: '4', y: '5', width: '16', height: '14', rx: '1' }]],
  ellipse: [['ellipse', { cx: '12', cy: '12', rx: '9', ry: '7' }]],
  diamond: [['path', { d: 'M12 3l9 9-9 9-9-9z' }]],
  triangle: [['path', { d: 'M12 4l9 16H3z' }]],
  'triangle-down': [['path', { d: 'M3 4h18l-9 16z' }]],
  pill: [['rect', { x: '3', y: '7', width: '18', height: '10', rx: '5' }]],
  connector: [
    ['circle', { cx: '6', cy: '18', r: '3' }],
    ['path', { d: 'M8.5 15.5L19 5' }],
    ['path', { d: 'M13 5h6v6' }],
  ],
  line: [
    ['path', { d: 'M4 18l6-10 5 7 5-9' }],
    ['circle', { cx: '4', cy: '18', r: '1.5' }],
    ['circle', { cx: '20', cy: '6', r: '1.5' }],
  ],
  text: [
    ['path', { d: 'M5 6V4h14v2' }],
    ['path', { d: 'M12 4v16' }],
    ['path', { d: 'M9 20h6' }],
  ],
  eraser: [
    [
      'path',
      {
        d: 'M8 20l-4.3-4.3a1 1 0 0 1 0-1.4L13.3 4.7a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21',
      },
    ],
    ['path', { d: 'M8 20h12' }],
    ['path', { d: 'M8.5 9.5l6 6' }],
  ],
  undo: [
    ['path', { d: 'M9 14L4 9l5-5' }],
    ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11' }],
  ],
  redo: [
    ['path', { d: 'M15 14l5-5-5-5' }],
    ['path', { d: 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13' }],
  ],
  plus: [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'M5 12h14' }],
  ],
  minus: [['path', { d: 'M5 12h14' }]],
  chevron: [['path', { d: 'M7 14l5-5 5 5' }]],
  lock: [
    ['rect', { x: '5', y: '11', width: '14', height: '10', rx: '2' }],
    ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }],
  ],
  unlock: [
    ['rect', { x: '5', y: '11', width: '14', height: '10', rx: '2' }],
    ['path', { d: 'M8 11V7a4 4 0 0 1 7.7-1.5' }],
  ],
  trash: [
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
    ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
  ],
  duplicate: [
    ['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2' }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  ],
  layer: [
    ['polygon', { points: '12 2 2 7 12 12 22 7 12 2' }],
    ['polyline', { points: '2 17 12 22 22 17' }],
    ['polyline', { points: '2 12 12 17 22 12' }],
  ],
  alignLeft: [
    ['path', { d: 'M21 6H3' }],
    ['path', { d: 'M15 12H3' }],
    ['path', { d: 'M17 18H3' }],
  ],
  alignCenter: [
    ['path', { d: 'M21 6H3' }],
    ['path', { d: 'M17 12H7' }],
    ['path', { d: 'M19 18H5' }],
  ],
  alignRight: [
    ['path', { d: 'M21 6H3' }],
    ['path', { d: 'M21 12H9' }],
    ['path', { d: 'M21 18H7' }],
  ],
  dashSolid: [['line', { x1: '3', y1: '12', x2: '21', y2: '12' }]],
  dashDashed: [
    ['line', { x1: '3', y1: '12', x2: '9', y2: '12' }],
    ['line', { x1: '15', y1: '12', x2: '21', y2: '12' }],
  ],
  dashDotted: [
    ['line', { x1: '3', y1: '12', x2: '5', y2: '12' }],
    ['line', { x1: '11', y1: '12', x2: '13', y2: '12' }],
    ['line', { x1: '19', y1: '12', x2: '21', y2: '12' }],
  ],
  // Shape fill: none (crossed out), semi-transparent, solid.
  fillNone: [
    ['rect', { x: '4', y: '4', width: '16', height: '16', rx: '2' }],
    ['path', { d: 'M4 20L20 4' }],
  ],
  fillSemi: [
    [
      'rect',
      { x: '4', y: '4', width: '16', height: '16', rx: '2', fill: 'currentColor', opacity: '0.35' },
    ],
    ['rect', { x: '4', y: '4', width: '16', height: '16', rx: '2' }],
  ],
  fillSolid: [
    ['rect', { x: '4', y: '4', width: '16', height: '16', rx: '2', fill: 'currentColor' }],
  ],
  // Connector path styles.
  connectorStraight: [['path', { d: 'M5 19L19 5' }]],
  connectorElbow: [['path', { d: 'M5 19v-7h14V5' }]],
  connectorCurved: [['path', { d: 'M5 19C5 11 19 13 19 5' }]],
  // End arrowheads, pointing right; start arrowheads are the mirrored versions below.
  ...arrowheads('end', IDENTITY),
  ...arrowheads('start', MIRROR),
};

/**
 * Names of the built-in icons.
 *
 * @public
 */
export const UI_ICON_NAMES: readonly string[] = Object.freeze(Object.keys(ICONS));

/** Elements and attributes kept from icon markup supplied by plugins. */
const ALLOWED_TAGS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
]);
const ALLOWED_ATTRIBUTES = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'width',
  'height',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'viewBox',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'transform',
  'opacity',
  'fill-rule',
  'clip-rule',
]);

function svgRoot(doc: Document, size: number): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

/** Rebuilds `source` with only allowed elements and attributes; drops scripts and handlers. */
function copySafe(doc: Document, source: Element, target: Element): void {
  for (const child of source.children) {
    const tag = child.localName;
    if (!ALLOWED_TAGS.has(tag) || tag === 'svg') continue;
    const clone = doc.createElementNS(SVG_NS, tag);
    for (const attr of child.attributes) {
      if (ALLOWED_ATTRIBUTES.has(attr.name) && !/url\s*\(|javascript:/i.test(attr.value)) {
        clone.setAttribute(attr.name, attr.value);
      }
    }
    copySafe(doc, child, clone);
    target.append(clone);
  }
}

/**
 * Creates an icon element (BOARD-1401).
 *
 * `icon` is a built-in name from {@link UI_ICON_NAMES}, or SVG markup with a 24 × 24 viewBox
 * (for plugin toolbar items). Markup is rebuilt from an allowlist of shape elements and
 * attributes, so scripts, event handlers, links, and external references never reach the page.
 * Returns `null` for an unknown name or unusable markup.
 *
 * @internal
 */
export function createIcon(
  doc: Document,
  icon: string | undefined,
  size = 20,
): SVGSVGElement | null {
  if (!icon) return null;
  const shapes = Object.hasOwn(ICONS, icon) ? ICONS[icon] : undefined;
  if (shapes) {
    const svg = svgRoot(doc, size);
    for (const [tag, attributes] of shapes) {
      const el = doc.createElementNS(SVG_NS, tag);
      for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
      svg.append(el);
    }
    return svg;
  }
  if (!icon.trimStart().startsWith('<svg')) return null;
  const Parser = doc.defaultView?.DOMParser;
  if (!Parser) return null;
  const parsed = new Parser().parseFromString(icon, 'image/svg+xml').documentElement;
  if (!parsed || parsed.localName !== 'svg') return null;
  const svg = svgRoot(doc, size);
  copySafe(doc, parsed, svg);
  return svg.childElementCount > 0 ? svg : null;
}
