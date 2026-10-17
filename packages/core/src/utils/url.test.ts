import { describe, expect, it } from 'vitest';
import {
  DEFAULT_URL_SCHEMES,
  isSafeUrl,
  MAX_URL_LENGTH,
  SAFE_LINK_REL,
  safeLinkAttributes,
  sanitizeUrl,
  url,
  validate,
} from '../index.js';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('BOARD-2002: isSafeUrl', () => {
  it('allows only https: and http: by default', () => {
    expect(DEFAULT_URL_SCHEMES).toEqual(['https:', 'http:']);
    expect(isSafeUrl('https://example.com/a?b=1#c')).toBe(true);
    expect(isSafeUrl('http://localhost:3000')).toBe(true);
    expect(isSafeUrl('HTTPS://EXAMPLE.COM')).toBe(true);
    expect(isSafeUrl('mailto:a@example.com')).toBe(false);
    expect(isSafeUrl('ftp://example.com')).toBe(false);
  });

  it('accepts extra schemes from the caller, with or without the colon', () => {
    expect(isSafeUrl('mailto:a@example.com', ['https:', 'mailto:'])).toBe(true);
    expect(isSafeUrl('tel:+62123', ['tel'])).toBe(true);
    expect(isSafeUrl('https://example.com', ['mailto:'])).toBe(false);
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    '\u0000javascript:alert(1)',
    '\u001fjavascript:alert(1)',
    'java\nscript:alert(1)',
    'java\tscript:alert(1)',
    'java\rscript:alert(1)',
    'javascript\n:alert(1)',
    ' javascript:alert(1)',
    '%6Aavascript:alert(1)',
    'javascript%3Aalert(1)',
    '&#106;avascript:alert(1)',
    '&#x6A;avascript:alert(1)',
    'jav&#x09;ascript:alert(1)',
    'vbscript:msgbox(1)',
    'VBScript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'data:text/html,<script>alert(1)</script>',
    PNG,
  ])('always rejects %j with the default schemes', (value) => {
    expect(isSafeUrl(value)).toBe(false);
  });

  it('rejects dangerous schemes even when the caller lists them', () => {
    const everything = ['javascript:', 'vbscript:', 'file:', 'about:', 'https:'];
    expect(isSafeUrl('javascript:alert(1)', everything)).toBe(false);
    expect(isSafeUrl('vbscript:msgbox(1)', everything)).toBe(false);
    expect(isSafeUrl('file:///etc/passwd', everything)).toBe(false);
    expect(isSafeUrl('about:blank', everything)).toBe(false);
  });

  it('allows data: only for base64 raster images, and only when listed', () => {
    const images = ['https:', 'data:'];
    expect(isSafeUrl(PNG, images)).toBe(true);
    expect(isSafeUrl(PNG.replace('image/png', 'image/webp'), images)).toBe(true);
    expect(isSafeUrl('data:image/svg+xml;base64,PHN2Zz4=', images)).toBe(false);
    expect(isSafeUrl('data:image/png,<svg onload=alert(1)>', images)).toBe(false);
    expect(isSafeUrl('data:text/html;base64,PHNjcmlwdD4=', images)).toBe(false);
    expect(isSafeUrl('DATA:IMAGE/PNG;BASE64,AAAA', images)).toBe(true);
  });

  it('rejects relative, scheme-relative, and host-less URLs', () => {
    expect(isSafeUrl('/path')).toBe(false);
    expect(isSafeUrl('path/to')).toBe(false);
    expect(isSafeUrl('//evil.example')).toBe(false);
    expect(isSafeUrl('https:evil.example')).toBe(false);
    expect(isSafeUrl('https:///evil.example')).toBe(false);
    expect(isSafeUrl('https://')).toBe(false);
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('   ')).toBe(false);
  });

  it('rejects whitespace or control characters inside the URL', () => {
    expect(isSafeUrl('https://exa mple.com')).toBe(false);
    expect(isSafeUrl('https://example.com/\u0000x')).toBe(false);
    expect(isSafeUrl('https://example.com/\u007f')).toBe(false);
  });

  it('enforces the length limit after normalization', () => {
    const base = 'https://example.com/';
    const atLimit = base + 'a'.repeat(MAX_URL_LENGTH - base.length);
    expect(isSafeUrl(atLimit)).toBe(true);
    expect(isSafeUrl(atLimit + 'a')).toBe(false);
    expect(isSafeUrl(` ${atLimit} `)).toBe(true);
    expect(isSafeUrl('https://example.com/abc', undefined, { maxLength: 10 })).toBe(false);
  });

  it('rejects non-strings and invalid scheme lists', () => {
    expect(isSafeUrl(undefined)).toBe(false);
    expect(isSafeUrl(42)).toBe(false);
    expect(isSafeUrl({ toString: () => 'https://example.com' })).toBe(false);
    expect(() => isSafeUrl('https://example.com', 'https:' as never)).toThrow(TypeError);
    expect(() => isSafeUrl('https://example.com', [1] as never)).toThrow(TypeError);
  });
});

describe('BOARD-2002: sanitizeUrl', () => {
  it('returns the URL as browsers will read it', () => {
    expect(sanitizeUrl('  https://example.com/a\n  ')).toBe('https://example.com/a');
    expect(sanitizeUrl('https://exam\tple.com')).toBe('https://example.com');
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('BOARD-2002: safeLinkAttributes', () => {
  it('opens safe links in a new tab with rel="noopener noreferrer"', () => {
    expect(SAFE_LINK_REL).toBe('noopener noreferrer');
    expect(safeLinkAttributes(' https://example.com ')).toEqual({
      href: 'https://example.com',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(safeLinkAttributes('javascript:alert(1)')).toBeNull();
    expect(safeLinkAttributes('mailto:a@example.com', ['mailto:'])?.rel).toBe(SAFE_LINK_REL);
  });
});

describe('BOARD-2002: url() schema primitive', () => {
  it('accepts normalized safe URLs and rejects the rest with unsafe_url', () => {
    const schema = url({ schemes: ['https:', 'mailto:'] });
    expect(validate(schema, 'https://example.com').ok).toBe(true);
    expect(validate(schema, 'mailto:a@example.com').ok).toBe(true);

    for (const bad of ['javascript:alert(1)', 'http://example.com', ' https://example.com']) {
      const result = validate(schema, bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]!.code).toBe('unsafe_url');
    }
  });

  it('reports type and length issues, and never echoes the value', () => {
    const typeResult = validate(url(), 42);
    expect(!typeResult.ok && typeResult.issues[0]!.code).toBe('type');
    const longResult = validate(url({ maxLength: 12 }), 'https://example.com');
    expect(!longResult.ok && longResult.issues[0]!.code).toBe('too_big');
    const unsafe = validate(url(), 'javascript:secret');
    expect(JSON.stringify(unsafe)).not.toContain('secret');
  });
});
