/**
 * Line icons for the UI (BOARD-1401): 24 × 24 box, stroke 2, round caps and joins, drawn in
 * `currentColor` (DESIGN.md Icons). Drawn for this package in the Lucide style; no third-party
 * artwork is bundled.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Shapes per icon; each entry is one SVG child element with its attributes. */
type IconShape = readonly [tag: string, attributes: Readonly<Record<string, string>>];

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
