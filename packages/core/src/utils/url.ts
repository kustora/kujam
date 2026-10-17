/**
 * Link and image URL validation (BOARD-2002).
 *
 * Board content comes from other users and peers, so every URL is untrusted. A URL is safe only when
 * it is absolute and its scheme is on an allowlist: by default `https:` and `http:`. `javascript:`,
 * `vbscript:`, and `data:` are always rejected, except `data:` raster images when the caller allows
 * `data:`. Checks are pure string checks (core has no DOM and no `URL` global in its lib), modelled on
 * how browsers parse URLs so that obfuscated variants cannot slip through:
 *
 * - leading and trailing C0 control characters and spaces are ignored, and ASCII tab and newline are
 *   removed anywhere, exactly as browsers do (`" java\nscript:"` is `javascript:`);
 * - the scheme is compared case-insensitively (`JaVaScRiPt:`);
 * - anything without a literal, valid scheme is rejected, which covers relative and scheme-relative
 *   URLs as well as percent- or entity-encoded schemes (`%6Aavascript:`, `&#106;avascript:`) that a
 *   later HTML or URL decoding step could turn into a dangerous one.
 */

/**
 * Schemes allowed by default for links and images.
 *
 * @public
 */
export const DEFAULT_URL_SCHEMES: readonly string[] = Object.freeze(['https:', 'http:']);

/**
 * Default maximum URL length, in UTF-16 code units (same as the rich text link limit, ADR-008).
 *
 * @public
 */
export const MAX_URL_LENGTH = 2048;

/**
 * `rel` value for opening user links: the new page gets no `window.opener` and no referrer.
 *
 * @public
 */
export const SAFE_LINK_REL = 'noopener noreferrer';

/**
 * Options for {@link isSafeUrl} and {@link sanitizeUrl}.
 *
 * @public
 */
export interface SafeUrlOptions {
  /** Maximum length after normalization. Defaults to {@link MAX_URL_LENGTH}. */
  readonly maxLength?: number;
}

/** Schemes that are never allowed, whatever the caller lists. `data:` is handled separately. */
const ALWAYS_BLOCKED = new Set(['javascript:', 'vbscript:', 'file:', 'about:']);

/** Raster image types allowed in `data:` URLs. SVG is excluded: it can carry script. */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/]+={0,2}$/i;

/** Schemes that need an authority (`//host`) to be meaningful. */
const HIERARCHICAL = new Set(['http:', 'https:']);

// eslint-disable-next-line no-control-regex -- matching control characters is the point here.
const EDGE_CONTROL = /^[\u0000- ]+|[\u0000- ]+$/g;
const TAB_OR_NEWLINE = /[\t\n\r]/g;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

function normalizeSchemes(allowedSchemes: readonly string[]): Set<string> {
  if (!Array.isArray(allowedSchemes) || allowedSchemes.some((s) => typeof s !== 'string')) {
    throw new TypeError('allowedSchemes wajib berupa array string, misalnya ["https:"].');
  }
  return new Set(
    allowedSchemes.map((s) => {
      const lower = s.trim().toLowerCase();
      return lower.endsWith(':') ? lower : `${lower}:`;
    }),
  );
}

/**
 * Normalizes `url` the way browsers do and returns it when it is safe, or `null` when it is not.
 * Store and render the returned value, not the input: the input may contain tab or newline
 * characters that browsers silently drop.
 *
 * @param url - Untrusted input; non-strings are rejected.
 * @param allowedSchemes - Allowed schemes, with or without the trailing colon (`'mailto'` or
 *   `'mailto:'`). Defaults to {@link DEFAULT_URL_SCHEMES}. Listing `data:` allows only base64
 *   raster images (`png`, `jpeg`, `gif`, `webp`, `avif`). `javascript:`, `vbscript:`, `file:`, and
 *   `about:` are rejected even when listed.
 * @throws `TypeError` when `allowedSchemes` is not an array of strings.
 * @public
 */
export function sanitizeUrl(
  url: unknown,
  allowedSchemes: readonly string[] = DEFAULT_URL_SCHEMES,
  options: SafeUrlOptions = {},
): string | null {
  const schemes = normalizeSchemes(allowedSchemes);
  if (typeof url !== 'string') return null;
  const maxLength = options.maxLength ?? MAX_URL_LENGTH;

  const normalized = url.replace(EDGE_CONTROL, '').replace(TAB_OR_NEWLINE, '');
  if (normalized.length === 0 || normalized.length > maxLength) return null;

  const match = SCHEME.exec(normalized);
  if (!match) return null;
  const scheme = `${match[1]!.toLowerCase()}:`;
  if (ALWAYS_BLOCKED.has(scheme) || !schemes.has(scheme)) return null;

  if (scheme === 'data:') return DATA_IMAGE.test(normalized) ? normalized : null;
  if (HIERARCHICAL.has(scheme)) {
    // `https:evil.example` or `https:///x` are fixed up by browsers in surprising ways; require a host.
    const rest = normalized.slice(scheme.length);
    if (!/^\/\/[^/\\?#\s]/.test(rest.replace(/\\/g, '/'))) return null;
  }
  // Whitespace or control characters inside the URL are never legitimate in a stored link.
  // eslint-disable-next-line no-control-regex -- see above.
  if (/[\u0000- \u007f]/.test(normalized)) return null;
  return normalized;
}

/**
 * Whether `url` is an absolute URL with an allowed scheme (BOARD-2002). See {@link sanitizeUrl} for
 * the rules; prefer `sanitizeUrl` when the value will be stored or rendered.
 *
 * @example
 * ```ts
 * isSafeUrl('https://example.com'); // true
 * isSafeUrl(' JavaScript:alert(1)'); // false
 * isSafeUrl('mailto:a@example.com', ['https:', 'http:', 'mailto:']); // true
 * ```
 *
 * @public
 */
export function isSafeUrl(
  url: unknown,
  allowedSchemes: readonly string[] = DEFAULT_URL_SCHEMES,
  options?: SafeUrlOptions,
): boolean {
  return sanitizeUrl(url, allowedSchemes, options) !== null;
}

/**
 * Attributes for rendering a user link that opens in a new tab, or `null` when the URL is unsafe.
 * Renderers and UI packages use this so every link gets `rel="noopener noreferrer"`.
 *
 * @public
 */
export function safeLinkAttributes(
  url: unknown,
  allowedSchemes: readonly string[] = DEFAULT_URL_SCHEMES,
  options?: SafeUrlOptions,
): { readonly href: string; readonly target: '_blank'; readonly rel: typeof SAFE_LINK_REL } | null {
  const href = sanitizeUrl(url, allowedSchemes, options);
  return href === null ? null : Object.freeze({ href, target: '_blank', rel: SAFE_LINK_REL });
}
