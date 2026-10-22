/**
 * Sandboxed iframe embed element (`type: 'embed'`, BOARD-1107, BOARD-2003). Not part of
 * `defaultElements`: an application installs it explicitly with {@link createEmbedElement} or
 * {@link createEmbedPlugin} and a list of allowed origins (ADR-009 T10).
 *
 * - Only `https:`/`http:` URLs whose origin matches the allowlist load. Everything else, including
 *   URLs from peers or imported documents, shows a "blocked" card instead of an iframe.
 * - The iframe always carries a `sandbox` attribute. Without configuration it is empty (every
 *   restriction applies); extra tokens come only from the matching origin's configuration.
 * - The iframe ignores the pointer until the element is double-clicked (or Enter is pressed on it),
 *   so dragging and zooming the board never get captured. A press outside it or Escape ends that.
 * - The HTML layer mounts the iframe only near the viewport (lazy loading, BOARD-804), and below
 *   `compactBelowZoom` the element is drawn as a static canvas card instead (BOARD-809).
 */

import {
  defineElement,
  definePlugin,
  rect,
  schema,
  string,
  type ElementCanvasContext,
  type ElementContext,
  type ElementRecord,
} from '@kujam/core';
import { a11yLabel, localize } from '../i18n.js';

/**
 * Longest URL an embed accepts (BOARD-1107).
 *
 * @beta
 */
export const MAX_EMBED_URL_LENGTH = 2048;

/**
 * Default zoom below which embeds are drawn as a static card instead of a live iframe.
 *
 * @beta
 */
export const DEFAULT_EMBED_COMPACT_ZOOM = 0.5;

/**
 * `sandbox` tokens an origin may be granted (BOARD-2003). `allow-top-navigation` and
 * `allow-top-navigation-to-custom-protocols` are deliberately missing: an embed must never navigate
 * the application away without a user gesture.
 *
 * @beta
 */
export const EMBED_SANDBOX_TOKENS = Object.freeze([
  'allow-downloads',
  'allow-forms',
  'allow-modals',
  'allow-orientation-lock',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-presentation',
  'allow-same-origin',
  'allow-scripts',
  'allow-storage-access-by-user-activation',
  'allow-top-navigation-by-user-activation',
] as const);

/**
 * A `sandbox` token from {@link EMBED_SANDBOX_TOKENS}.
 *
 * @beta
 */
export type EmbedSandboxToken = (typeof EMBED_SANDBOX_TOKENS)[number];

/**
 * Referrer policies an embed may use. Defaults to `strict-origin-when-cross-origin`: the embedded
 * site sees only the application's origin, never the page path.
 *
 * @beta
 */
export type EmbedReferrerPolicy =
  'no-referrer' | 'origin' | 'same-origin' | 'strict-origin' | 'strict-origin-when-cross-origin';

/**
 * One allowed origin and what its iframes may do (BOARD-1107, BOARD-2003).
 *
 * @beta
 */
export interface EmbedDomain {
  /**
   * Origin such as `'https://www.youtube-nocookie.com'`, or `'https://*.example.com'` for every
   * subdomain of `example.com` (not `example.com` itself). Scheme and port must match exactly; a
   * path is not allowed.
   */
  readonly origin: string;
  /** Extra `sandbox` tokens for this origin. Defaults to none. */
  readonly sandbox?: readonly EmbedSandboxToken[];
  /** Permissions Policy features delegated through `allow`, for example `'fullscreen'`. */
  readonly allow?: readonly string[];
  /** Referrer policy for this origin. Defaults to `strict-origin-when-cross-origin`. */
  readonly referrerPolicy?: EmbedReferrerPolicy;
}

/**
 * Options for {@link createEmbedElement}.
 *
 * @beta
 */
export interface EmbedElementOptions {
  /**
   * Allowed origins; a string is shorthand for `{ origin }` with no extra permissions. An empty
   * list blocks every URL.
   */
  readonly domains: readonly (string | EmbedDomain)[];
  /** Zoom below which a static card replaces the iframe. Defaults to {@link DEFAULT_EMBED_COMPACT_ZOOM}. */
  readonly compactBelowZoom?: number;
}

/**
 * Props for an `embed` element.
 *
 * @beta
 */
export interface EmbedProps extends Record<string, unknown> {
  /** Page to embed. Loads only when its origin is allowed. */
  url: string;
  /** Accessible title of the iframe; defaults to the URL's host when empty. */
  title: string;
}

declare module '@kujam/core' {
  interface BoardElementTypes {
    embed: EmbedProps;
  }
}

/**
 * Validation schema for {@link EmbedProps}.
 *
 * @beta
 */
export const embedPropsSchema = schema({
  url: string({ maxLength: MAX_EMBED_URL_LENGTH }),
  title: string({ maxLength: 300 }),
});

/**
 * What an allowed URL is loaded with: the normalized URL and the iframe attributes.
 *
 * @beta
 */
export interface ResolvedEmbed {
  readonly url: string;
  readonly origin: string;
  /** Value of the `sandbox` attribute; `''` applies every restriction. */
  readonly sandbox: string;
  /** Value of the `allow` attribute; `''` delegates no feature. */
  readonly allow: string;
  readonly referrerPolicy: EmbedReferrerPolicy;
}

interface CompiledDomain {
  readonly scheme: string;
  /** Exact host, or the suffix (with leading dot) for wildcard rules. */
  readonly host: string;
  readonly wildcard: boolean;
  readonly port: string;
  readonly sandbox: readonly EmbedSandboxToken[];
  readonly allow: readonly string[];
  readonly referrerPolicy: EmbedReferrerPolicy;
}

const REFERRER_POLICIES: readonly EmbedReferrerPolicy[] = [
  'no-referrer',
  'origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
];
const FEATURE_NAME = /^[a-z][a-z0-9-]*$/;

function compileDomain(entry: string | EmbedDomain): CompiledDomain {
  const rule: EmbedDomain = typeof entry === 'string' ? { origin: entry } : entry;
  const raw = rule.origin;
  const match = /^(https?):\/\/(\*\.)?([^/:?#*]+)(?::(\d+))?$/i.exec(raw ?? '');
  if (!match) {
    throw new TypeError(
      `Embed origin "${raw}" is invalid: use "https://host", "https://host:port", or "https://*.host".`,
    );
  }
  // Normalize through URL (lowercase, punycode, default port).
  const url = new URL(`${match[1]}://${match[3]}${match[4] ? `:${match[4]}` : ''}`);
  const sandbox = [...new Set(rule.sandbox ?? [])];
  for (const token of sandbox) {
    if (!(EMBED_SANDBOX_TOKENS as readonly string[]).includes(token)) {
      throw new TypeError(`Embed origin "${raw}": sandbox token "${token}" is not allowed.`);
    }
  }
  const allow = [...new Set(rule.allow ?? [])];
  for (const feature of allow) {
    if (!FEATURE_NAME.test(feature)) {
      throw new TypeError(
        `Embed origin "${raw}": "${feature}" is not a permission policy feature.`,
      );
    }
  }
  const referrerPolicy = rule.referrerPolicy ?? 'strict-origin-when-cross-origin';
  if (!REFERRER_POLICIES.includes(referrerPolicy)) {
    throw new TypeError(
      `Embed origin "${raw}": referrer policy "${referrerPolicy}" is not allowed.`,
    );
  }
  return Object.freeze({
    scheme: url.protocol,
    host: match[2] ? `.${url.hostname}` : url.hostname,
    wildcard: Boolean(match[2]),
    port: url.port,
    sandbox: Object.freeze(sandbox),
    allow: Object.freeze(allow),
    referrerPolicy,
  });
}

function compileDomains(domains: readonly (string | EmbedDomain)[]): readonly CompiledDomain[] {
  if (!Array.isArray(domains)) {
    throw new TypeError('Embed element: `domains` must be a list of allowed origins.');
  }
  return Object.freeze(domains.map(compileDomain));
}

function matchUrl(url: string, domains: readonly CompiledDomain[]): ResolvedEmbed | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_EMBED_URL_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // `javascript:`, `data:`, `blob:`, `file:`, ... never load, nor do URLs with credentials.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password) return null;
  const host = parsed.hostname;
  const rule = domains.find(
    (d) =>
      d.scheme === parsed.protocol &&
      d.port === parsed.port &&
      (d.wildcard ? host.endsWith(d.host) && host.length > d.host.length : host === d.host),
  );
  if (!rule) return null;
  return {
    url: parsed.href,
    origin: parsed.origin,
    sandbox: rule.sandbox.join(' '),
    allow: rule.allow.join('; '),
    referrerPolicy: rule.referrerPolicy,
  };
}

/**
 * Checks `url` against an origin allowlist the same way the embed element does (BOARD-1107), for
 * example to validate a URL before creating an element. Returns `null` when it may not be embedded.
 *
 * @throws TypeError when the allowlist itself is invalid.
 * @beta
 */
export function resolveEmbed(
  url: string,
  domains: readonly (string | EmbedDomain)[],
): ResolvedEmbed | null {
  return matchUrl(url, compileDomains(domains));
}

/** Controls of mounted embed views per board (keyed by the board's element context). */
const activeViews = new WeakMap<ElementContext, Map<string, { activate(): void }>>();

function viewsOf(ctx: ElementContext): Map<string, { activate(): void }> {
  let views = activeViews.get(ctx);
  if (!views) {
    views = new Map();
    activeViews.set(ctx, views);
  }
  return views;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

const TEXT = {
  kind: { id: 'Sematan', en: 'Embed' },
  blocked: { id: 'Sematan diblokir', en: 'Embed blocked' },
  activate: {
    id: 'Klik dua kali untuk berinteraksi',
    en: 'Double-click to interact',
  },
} as const;

/** Static card for the canvas (compact zoom, exports, thumbnails) and the blocked state. */
function drawCard(
  g: ElementCanvasContext,
  el: ElementRecord<EmbedProps>,
  allowed: boolean,
  ctx: ElementContext | undefined,
): void {
  const dark = ctx?.theme?.mode === 'dark';
  const locale = ctx?.locale ?? 'id';
  g.save();
  g.fillStyle = dark ? '#2A2D34' : '#F4F3EF';
  g.fillRect(0, 0, el.w, el.h);
  g.strokeStyle = allowed ? (dark ? '#4A4F59' : '#C9C6BD') : '#D64545';
  g.lineWidth = 1;
  if (!allowed) g.setLineDash([6, 4]);
  g.strokeRect(0, 0, el.w, el.h);
  g.setLineDash([]);
  const size = Math.max(10, Math.min(16, el.h / 8));
  g.font = `600 ${size}px ${ctx?.theme?.typography?.fontFamily ?? 'system-ui, sans-serif'}`;
  g.fillStyle = allowed ? (dark ? '#E6E8EC' : '#17191E') : '#D64545';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const title = allowed
    ? el.props.title.trim() || hostOf(el.props.url)
    : localize(TEXT.blocked, locale);
  g.fillText(title || localize(TEXT.kind, locale), el.w / 2, el.h / 2 - size * 0.7, el.w - 16);
  g.font = `${size * 0.8}px ${ctx?.theme?.typography?.fontFamily ?? 'system-ui, sans-serif'}`;
  g.fillStyle = dark ? '#B4B8C0' : '#4A4F59';
  g.fillText(hostOf(el.props.url), el.w / 2, el.h / 2 + size * 0.7, el.w - 16);
  g.restore();
}

/**
 * Creates the sandboxed iframe `embed` element (BOARD-1107, BOARD-2003). It is not in
 * `defaultElements`; install it explicitly with the origins the application trusts:
 *
 * @example
 * ```ts
 * const embed = createEmbedElement({
 *   domains: [
 *     { origin: 'https://www.youtube-nocookie.com', sandbox: ['allow-scripts', 'allow-same-origin'], allow: ['fullscreen'] },
 *     'https://*.example.com',
 *   ],
 * });
 * createBoard({ plugins: [defaultElements, definePlugin({ id: 'embed', elements: [embed] })] });
 * board.create({ type: 'embed', w: 480, h: 270, props: { url: 'https://www.youtube-nocookie.com/embed/…' } });
 * ```
 *
 * The iframe always has a `sandbox` attribute: empty unless the matching origin grants tokens.
 * An origin granted both `allow-scripts` and `allow-same-origin` could lift its own sandbox when
 * it is the application's origin, so such URLs on the application's own origin are blocked.
 *
 * @throws TypeError when `domains` holds an invalid origin, sandbox token, or feature.
 * @beta
 */
export function createEmbedElement(options: EmbedElementOptions) {
  const domains = compileDomains(options?.domains);
  const compactBelowZoom = options.compactBelowZoom ?? DEFAULT_EMBED_COMPACT_ZOOM;

  return defineElement({
    type: 'embed',
    version: 1,
    props: embedPropsSchema,
    defaults: { url: '', title: '' },
    minSize: { w: 80, h: 45 },
    geometry: (el) => rect(el.w, el.h),
    lod: { compactBelowZoom },
    onDoubleClick: (el, ctx) => {
      activeViews.get(ctx)?.get(el.id)?.activate();
    },
    a11y: (el, _data, ctx) => ({
      role: 'group',
      label: a11yLabel(
        localize(TEXT.kind, ctx.locale),
        el.props.title.trim() || hostOf(el.props.url),
      ),
      description: localize(TEXT.activate, ctx.locale),
    }),
    export: {
      text: (el) => el.props.url,
    },
    render: {
      canvas: (g, el, _data, _lod, ctx) =>
        drawCard(g, el, matchUrl(el.props.url, domains) !== null, ctx),
      html(hostNode, initial, _data, ctx) {
        const host = hostNode as unknown as HTMLElement;
        const doc = host.ownerDocument;
        const views = viewsOf(ctx);
        let el = initial;
        let iframe: HTMLIFrameElement | null = null;
        let loadedUrl: string | null = null;
        let active = false;

        const onOutsidePointer = (e: Event) => {
          if (!host.contains(e.target as Node | null)) deactivate();
        };
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') deactivate();
        };

        function setActive(next: boolean): void {
          if (!iframe || active === next) return;
          active = next;
          iframe.style.pointerEvents = next ? 'auto' : 'none';
          host.style.outline = next ? `2px solid ${ctx.theme.selection?.stroke ?? '#2F6FDB'}` : '';
          host.dataset.kujamEmbedActive = next ? 'true' : 'false';
          if (next) {
            doc.addEventListener('pointerdown', onOutsidePointer, true);
            doc.addEventListener('keydown', onKey, true);
            iframe.focus();
          } else {
            doc.removeEventListener('pointerdown', onOutsidePointer, true);
            doc.removeEventListener('keydown', onKey, true);
          }
        }
        function deactivate(): void {
          setActive(false);
        }

        function blocked(): void {
          setActive(false);
          iframe = null;
          loadedUrl = null;
          const card = doc.createElement('div');
          card.dataset.kujamEmbedBlocked = '';
          Object.assign(card.style, {
            boxSizing: 'border-box',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            padding: '8px',
            border: '1px dashed #D64545',
            color: '#D64545',
            background: ctx.theme.mode === 'dark' ? '#2A2D34' : '#F4F3EF',
            fontFamily: ctx.theme.typography?.fontFamily ?? 'system-ui, sans-serif',
            fontSize: '12px',
            textAlign: 'center',
            overflow: 'hidden',
          } satisfies Partial<CSSStyleDeclaration>);
          const label = doc.createElement('strong');
          label.textContent = localize(TEXT.blocked, ctx.locale);
          const origin = doc.createElement('span');
          // Text only: the URL is untrusted document data.
          origin.textContent = hostOf(el.props.url);
          card.append(label, origin);
          host.replaceChildren(card);
        }

        function render(): void {
          const resolved = matchUrl(el.props.url, domains);
          const pageOrigin = doc.defaultView?.location?.origin;
          const canEscape =
            resolved !== null &&
            resolved.origin === pageOrigin &&
            resolved.sandbox.includes('allow-scripts') &&
            resolved.sandbox.includes('allow-same-origin');
          if (!resolved || canEscape) {
            blocked();
            return;
          }
          const title = el.props.title.trim() || hostOf(resolved.url);
          if (iframe && loadedUrl === resolved.url) {
            iframe.title = title;
            return;
          }
          setActive(false);
          const frame = doc.createElement('iframe');
          // Attributes first, `src` last, so the document never loads without its sandbox.
          frame.setAttribute('sandbox', resolved.sandbox);
          if (resolved.allow) frame.setAttribute('allow', resolved.allow);
          frame.setAttribute('referrerpolicy', resolved.referrerPolicy);
          frame.setAttribute('loading', 'lazy');
          frame.title = title;
          Object.assign(frame.style, {
            display: 'block',
            width: '100%',
            height: '100%',
            border: '0',
            pointerEvents: 'none',
          } satisfies Partial<CSSStyleDeclaration>);
          frame.src = resolved.url;
          iframe = frame;
          loadedUrl = resolved.url;
          host.replaceChildren(frame);
        }

        const control = { activate: () => setActive(true) };
        views.set(el.id, control);
        render();

        return {
          update(next) {
            el = next;
            render();
          },
          destroy() {
            setActive(false);
            if (views.get(el.id) === control) views.delete(el.id);
            host.replaceChildren();
            host.style.outline = '';
            delete host.dataset.kujamEmbedActive;
            iframe = null;
          },
        };
      },
    },
  });
}

/**
 * Plugin with the `embed` element from {@link createEmbedElement}, for
 * `createBoard({ plugins: [defaultElements, createEmbedPlugin({ domains })] })` (BOARD-1107).
 *
 * @beta
 */
export function createEmbedPlugin(options: EmbedElementOptions) {
  return definePlugin({ id: 'embed', elements: [createEmbedElement(options)] as const });
}
