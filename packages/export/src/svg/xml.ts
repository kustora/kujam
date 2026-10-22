/**
 * Minimal SVG node tree, serializer, parser, and sanitizer for the SVG export (BOARD-1702).
 *
 * The export never builds markup by string concatenation of untrusted values: everything goes
 * through {@link SvgNode} and {@link serializeSvg}, which escapes all text and attribute values.
 * SVG fragments from custom elements (`export.svg`) are parsed with a small DOM-free XML parser
 * (so it also runs in Node and workers) and rebuilt from an allowlist of elements and attributes:
 * scripts, event handlers, `foreignObject`, `<style>`, animations, and external references are
 * dropped.
 *
 * @internal
 */

import { sanitizeUrl } from '@kujam/core';

/** An SVG element: tag name, attributes, and children (elements or text). */
export interface SvgNode {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  readonly children: (SvgNode | string)[];
}

/** Creates an {@link SvgNode}; `undefined` attribute values are left out. */
export function el(
  tag: string,
  attrs: Record<string, string | number | undefined> = {},
  children: (SvgNode | string)[] = [],
): SvgNode {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    out[key] = typeof value === 'number' ? fmt(value) : value;
  }
  return { tag, attrs: out, children };
}

/** Formats a number for SVG output: finite, at most 3 decimals, no `-0`. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** Escapes text content for XML. */
export function escapeText(text: string): string {
  return stripInvalidXmlChars(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escapes an attribute value for a double-quoted XML attribute. */
export function escapeAttr(value: string): string {
  return escapeText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

/** Removes characters that are not allowed in XML 1.0 documents. */
function stripInvalidXmlChars(text: string): string {
  // eslint-disable-next-line no-control-regex -- removing control characters is the point here.
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

const SAFE_NAME = /^[A-Za-z_][\w.:-]*$/;

/** Serializes a node tree to markup, escaping every text and attribute value. */
export function serializeSvg(node: SvgNode | string): string {
  if (typeof node === 'string') return escapeText(node);
  if (!SAFE_NAME.test(node.tag)) return '';
  let out = `<${node.tag}`;
  for (const [key, value] of Object.entries(node.attrs)) {
    if (!SAFE_NAME.test(key)) continue;
    out += ` ${key}="${escapeAttr(value)}"`;
  }
  if (node.children.length === 0) return `${out}/>`;
  out += '>';
  for (const child of node.children) out += serializeSvg(child);
  return `${out}</${node.tag}>`;
}

// ---------- Parser ----------

const ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/** Decodes the predefined XML entities and numeric character references. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    }
    return ENTITIES[body] ?? match;
  });
}

const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/**
 * Parses an XML fragment into nodes. Tolerant: unknown or unbalanced closing tags are ignored,
 * comments, processing instructions, and doctypes are skipped, and CDATA becomes text. No entity
 * declarations are honored.
 */
export function parseXmlFragment(source: string): (SvgNode | string)[] {
  const root: SvgNode = { tag: '#root', attrs: {}, children: [] };
  const stack: SvgNode[] = [root];
  let i = 0;
  const top = (): SvgNode => stack[stack.length - 1]!;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      pushText(top(), source.slice(i));
      break;
    }
    if (lt > i) pushText(top(), source.slice(i, lt));
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      const text = source.slice(lt + 9, end === -1 ? source.length : end);
      if (text) top().children.push(text);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source[lt + 1] === '?' || source[lt + 1] === '!') {
      i = skipDeclaration(source, lt);
      continue;
    }
    const end = findTagEnd(source, lt + 1);
    if (end === -1) break;
    const body = source.slice(lt + 1, end);
    i = end + 1;
    if (body[0] === '/') {
      const name = body.slice(1).trim();
      const at = findOpen(stack, name);
      if (at > 0) stack.length = at;
      continue;
    }
    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const nameMatch = /^[^\s/>]+/.exec(inner);
    if (!nameMatch) continue;
    const tag = nameMatch[0];
    const attrs: Record<string, string> = {};
    ATTR.lastIndex = tag.length;
    let m: RegExpExecArray | null;
    while ((m = ATTR.exec(inner)) !== null) {
      const name = m[1]!;
      if (Object.hasOwn(attrs, name)) continue;
      attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
    }
    const node: SvgNode = { tag, attrs, children: [] };
    top().children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root.children;
}

function pushText(parent: SvgNode, raw: string): void {
  if (raw.length === 0) return;
  parent.children.push(decodeEntities(raw));
}

/** Index of the innermost open element named `name` in `stack`, or `-1`. */
function findOpen(stack: readonly SvgNode[], name: string): number {
  for (let k = stack.length - 1; k > 0; k--) if (stack[k]!.tag === name) return k;
  return -1;
}

/** End of a tag starting after `<`, skipping `>` inside quoted attribute values. */
function findTagEnd(source: string, from: number): number {
  let quote: string | null = null;
  for (let k = from; k < source.length; k++) {
    const c = source[k];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return k;
    }
  }
  return -1;
}

/** Skips `<?...?>` and `<!...>` (including a doctype with an internal subset). */
function skipDeclaration(source: string, lt: number): number {
  let depth = 0;
  for (let k = lt + 1; k < source.length; k++) {
    const c = source[k];
    if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '>' && depth <= 0) return k + 1;
  }
  return source.length;
}

// ---------- Sanitizer ----------

/** Elements kept from custom `export.svg` fragments. Everything else is dropped with its subtree. */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'image',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'linearGradient',
  'radialGradient',
  'stop',
  'title',
  'desc',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComposite',
  'feDropShadow',
  'feFlood',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feOffset',
]);

/** Elements whose children are kept while the element itself is dropped. */
const UNWRAPPED_ELEMENTS = new Set(['a', 'switch']);

const ATTRIBUTE_NAME = /^[A-Za-z][\w.-]*(?::[A-Za-z][\w.-]*)?$/;
const LOCAL_REF = /^#[\w.:-]+$/;
const DANGEROUS_VALUE = /javascript:|vbscript:|expression\s*\(|@import|behavior\s*:|-moz-binding/i;
const URL_REF = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const IMAGE_SCHEMES = ['https:', 'http:', 'data:'];

/** Options for {@link sanitizeSvgFragment}. */
export interface SanitizeOptions {
  /** Prefix for IDs inside the fragment, so fragments of different elements never collide. */
  readonly idPrefix: string;
  /** Whether `<image>` may reference `http(s):` URLs (otherwise only raster `data:` URLs). */
  readonly allowRemoteImages: boolean;
}

/** Result of {@link sanitizeSvgFragment}. */
export interface SanitizeResult {
  readonly nodes: (SvgNode | string)[];
  /** Number of elements or attributes removed. */
  readonly removed: number;
}

/**
 * Parses an untrusted SVG fragment and rebuilds it from the allowlist. IDs are prefixed and
 * local references (`url(#id)`, `href="#id"`) rewritten to match.
 */
export function sanitizeSvgFragment(source: string, options: SanitizeOptions): SanitizeResult {
  const parsed = parseXmlFragment(source);
  const ids = new Set<string>();
  collectIds(parsed, ids);
  let removed = 0;
  const rename = (id: string): string => (ids.has(id) ? `${options.idPrefix}-${id}` : id);

  const cleanNodes = (nodes: readonly (SvgNode | string)[]): (SvgNode | string)[] => {
    const out: (SvgNode | string)[] = [];
    for (const node of nodes) {
      if (typeof node === 'string') {
        out.push(node);
        continue;
      }
      const tag = node.tag.startsWith('svg:') ? node.tag.slice(4) : node.tag;
      if (UNWRAPPED_ELEMENTS.has(tag)) {
        removed++;
        out.push(...cleanNodes(node.children));
        continue;
      }
      if (!ALLOWED_ELEMENTS.has(tag)) {
        removed++;
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const [rawName, value] of Object.entries(node.attrs)) {
        const cleaned = cleanAttribute(tag, rawName, value, options, rename);
        if (cleaned === null) {
          removed++;
          continue;
        }
        attrs[cleaned[0]] = cleaned[1];
      }
      out.push({ tag, attrs, children: cleanNodes(node.children) });
    }
    return out;
  };

  return { nodes: cleanNodes(parsed), removed };
}

function collectIds(nodes: readonly (SvgNode | string)[], ids: Set<string>): void {
  for (const node of nodes) {
    if (typeof node === 'string') continue;
    const id = node.attrs.id;
    if (typeof id === 'string' && id) ids.add(id);
    collectIds(node.children, ids);
  }
}

/** Returns the attribute to keep as `[name, value]`, or `null` to drop it. */
function cleanAttribute(
  tag: string,
  rawName: string,
  value: string,
  options: SanitizeOptions,
  rename: (id: string) => string,
): [string, string] | null {
  if (!ATTRIBUTE_NAME.test(rawName)) return null;
  const name = rawName.toLowerCase();
  if (name.startsWith('on') || name.startsWith('xmlns')) return null;
  if (name === 'style' && /[<>]/.test(value)) return null;
  if (DANGEROUS_VALUE.test(value)) return null;

  if (name === 'href' || name === 'xlink:href') {
    const trimmed = value.trim();
    if (LOCAL_REF.test(trimmed)) return ['href', `#${rename(trimmed.slice(1))}`];
    if (tag !== 'image') return null;
    const safe = sanitizeUrl(trimmed, options.allowRemoteImages ? IMAGE_SCHEMES : ['data:'], {
      maxLength: MAX_DATA_URL_LENGTH,
    });
    return safe === null ? null : ['href', safe];
  }
  if (name === 'id') return ['id', rename(value)];

  // Any CSS `url()` must point inside the fragment.
  let unsafe = false;
  const rewritten = value.replace(URL_REF, (_match, _quote, target: string) => {
    const ref = target.trim();
    if (!LOCAL_REF.test(ref)) {
      unsafe = true;
      return 'none';
    }
    return `url(#${rename(ref.slice(1))})`;
  });
  if (unsafe) return null;
  return [rawName, rewritten];
}

/** Longest `data:` URL accepted inside an exported SVG (32 MiB). */
export const MAX_DATA_URL_LENGTH = 32 * 1024 * 1024;
