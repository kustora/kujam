import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  rect,
  validate,
  type ElementCanvasContext,
  type ElementContext,
  type ElementRecord,
} from '@kujam/core';
import {
  ALLOWED_IMAGE_SCHEMES,
  cacheLoadedImage,
  clearImageCache,
  DEFAULT_IMAGE_SIZE,
  imageCropSchema,
  imageElement,
  imagePropsSchema,
  sanitizeImageUrl,
  type ImageProps,
} from './image.js';

function makeImageElement(props: Partial<ImageProps> = {}, w = 320, h = 240): ElementRecord<ImageProps> {
  return {
    id: 'img-1',
    kind: 'element',
    type: 'image',
    pageId: 'page-1',
    parentId: null,
    index: 'a0',
    x: 0,
    y: 0,
    rotation: 0,
    w,
    h,
    locked: false,
    opacity: 1,
    props: {
      assetId: 'asset-1',
      crop: null,
      alt: '',
      ...props,
    },
    meta: {},
  };
}

function createMockCanvas(): { g: ElementCanvasContext; calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1 };
  const g = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
      return (...args: unknown[]) => calls.push(`${key}(${args.map((a) => (typeof a === 'object' && a !== null ? '[object]' : a)).join(',')})`);
    },
    set(target, key: string, value) {
      target[key] = value;
      calls.push(`${key}=${value}`);
      return true;
    },
  }) as unknown as ElementCanvasContext;
  return { g, calls };
}

describe('BOARD-1103 & BOARD-1906: Image Element and AssetResolver', () => {
  beforeEach(() => {
    clearImageCache();
  });

  describe('Definitions and Defaults', () => {
    it('defines image element metadata and geometry', () => {
      expect(imageElement.type).toBe('image');
      expect(imageElement.version).toBe(1);
      expect(imageElement.resize).toBe('fixed-ratio');
      expect(imageElement.minSize).toEqual({ w: 16, h: 16 });
      expect(DEFAULT_IMAGE_SIZE).toEqual({ w: 320, h: 240 });

      const el = makeImageElement();
      expect(imageElement.geometry(el)).toEqual(rect(320, 240));
    });

    it('exports text based on alt property', () => {
      const elWithAlt = makeImageElement({ alt: 'Deskripsi gambar pemandangan' });
      expect(imageElement.export?.text?.(elWithAlt)).toBe('Deskripsi gambar pemandangan');

      const elNoAlt = makeImageElement({ alt: undefined });
      expect(imageElement.export?.text?.(elNoAlt)).toBe('');
    });
  });

  describe('Props Validation', () => {
    it('validates correct image props and defaults', () => {
      const valid = {
        assetId: 'asset-xyz',
        crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
        alt: 'Illustration of architecture',
        uploadStatus: 'ready' as const,
        uploadProgress: 100,
        uploadError: undefined,
      };
      expect(validate(imagePropsSchema, valid).ok).toBe(true);
      expect(validate(imagePropsSchema, imageElement.defaults).ok).toBe(true);
    });

    it('enforces assetId requirement', () => {
      expect(validate(imagePropsSchema, {}).ok).toBe(false);
      expect(validate(imagePropsSchema, { assetId: 123 }).ok).toBe(false);
    });

    it('validates crop bounds in [0, 1] range', () => {
      expect(validate(imageCropSchema, { x: 0, y: 0, w: 1, h: 1 }).ok).toBe(true);
      expect(validate(imageCropSchema, { x: 0.5, y: 0.5, w: 0.001, h: 0.001 }).ok).toBe(true);

      // Negative values
      expect(validate(imageCropSchema, { x: -0.1, y: 0, w: 0.5, h: 0.5 }).ok).toBe(false);
      expect(validate(imageCropSchema, { x: 0, y: -0.01, w: 0.5, h: 0.5 }).ok).toBe(false);

      // Exceeding 1.0
      expect(validate(imageCropSchema, { x: 1.1, y: 0, w: 0.5, h: 0.5 }).ok).toBe(false);
      expect(validate(imageCropSchema, { x: 0, y: 1.05, w: 0.5, h: 0.5 }).ok).toBe(false);
      expect(validate(imageCropSchema, { x: 0, y: 0, w: 1.1, h: 0.5 }).ok).toBe(false);

      // Width or height too small (< 0.001)
      expect(validate(imageCropSchema, { x: 0, y: 0, w: 0.0001, h: 0.5 }).ok).toBe(false);
      expect(validate(imageCropSchema, { x: 0, y: 0, w: 0.5, h: 0 }).ok).toBe(false);
    });

    it('enforces alt max length of 500 characters', () => {
      const validAlt = 'a'.repeat(500);
      expect(validate(imagePropsSchema, { assetId: 'a', alt: validAlt }).ok).toBe(true);

      const tooLongAlt = 'a'.repeat(501);
      expect(validate(imagePropsSchema, { assetId: 'a', alt: tooLongAlt }).ok).toBe(false);
    });

    it('validates upload status, progress, and error', () => {
      for (const status of ['pending', 'uploading', 'error', 'ready'] as const) {
        expect(validate(imagePropsSchema, { assetId: 'a', uploadStatus: status }).ok).toBe(true);
      }
      expect(validate(imagePropsSchema, { assetId: 'a', uploadStatus: 'invalid' }).ok).toBe(false);

      expect(validate(imagePropsSchema, { assetId: 'a', uploadProgress: 0 }).ok).toBe(true);
      expect(validate(imagePropsSchema, { assetId: 'a', uploadProgress: 100 }).ok).toBe(true);
      expect(validate(imagePropsSchema, { assetId: 'a', uploadProgress: -1 }).ok).toBe(false);
      expect(validate(imagePropsSchema, { assetId: 'a', uploadProgress: 101 }).ok).toBe(false);

      expect(validate(imagePropsSchema, { assetId: 'a', uploadError: 'Network failure' }).ok).toBe(true);
      expect(validate(imagePropsSchema, { assetId: 'a', uploadError: 'x'.repeat(501) }).ok).toBe(false);
    });
  });

  describe('Accessibility (BOARD-1906)', () => {
    it('uses role "img" and trimmed alt text when present', () => {
      const el = makeImageElement({ alt: '  Diagram alir autentikasi pengguna  ' });
      const a11y = imageElement.a11y?.(el, undefined, { locale: 'en' } as never);
      expect(a11y?.role).toBe('img');
      expect(a11y?.label).toBe('Diagram alir autentikasi pengguna');
    });

    it('provides fallback bilingual label when alt text is empty or missing', () => {
      const el = makeImageElement({ alt: '   ' });

      const a11yEn = imageElement.a11y?.(el, undefined, { locale: 'en' } as never);
      expect(a11yEn?.role).toBe('img');
      expect(a11yEn?.label).toBe('Image');

      const a11yEnUs = imageElement.a11y?.(el, undefined, { locale: 'en-US' } as never);
      expect(a11yEnUs?.label).toBe('Image');

      const a11yId = imageElement.a11y?.(el, undefined, { locale: 'id' } as never);
      expect(a11yId?.label).toBe('Gambar');
    });
  });

  describe('Double Click Interaction', () => {
    it('emits "image.crop" and "edit" on double-click to enter crop mode', () => {
      const el = makeImageElement();
      const emit = vi.fn();
      imageElement.onDoubleClick?.(el, { emit, locale: 'en' } as never);

      expect(emit).toHaveBeenCalledWith('image.crop', { elementId: el.id });
      expect(emit).toHaveBeenCalledWith('edit');
    });
  });

  describe('Contextual Actions', () => {
    it('provides image.alt action allowing alt text updates', () => {
      const el = makeImageElement({ alt: 'Old alt' });
      const updateProps = vi.fn();
      const emit = vi.fn();
      const ctx = { locale: 'en', updateProps, emit } as never;

      const actions = imageElement.actions?.(el, undefined, ctx);
      const altAction = actions?.find((a) => a.id === 'image.alt');
      expect(altAction).toBeDefined();
      expect(altAction?.label).toBe('Alt text');

      altAction?.run('New accessible description');
      expect(updateProps).toHaveBeenCalledWith({ alt: 'New accessible description' });
      expect(emit).toHaveBeenCalledWith('image.alt', { elementId: el.id, alt: 'New accessible description' });

      // Bilingual Indonesian label
      const actionsId = imageElement.actions?.(el, undefined, { locale: 'id', updateProps, emit } as never);
      expect(actionsId?.find((a) => a.id === 'image.alt')?.label).toBe('Teks alternatif');
    });

    it('provides image.crop action that emits image.crop event', () => {
      const el = makeImageElement();
      const emit = vi.fn();
      const ctx = { locale: 'en', emit } as never;

      const actions = imageElement.actions?.(el, undefined, ctx);
      const cropAction = actions?.find((a) => a.id === 'image.crop');
      expect(cropAction).toBeDefined();
      expect(cropAction?.label).toBe('Crop image');

      cropAction?.run();
      expect(emit).toHaveBeenCalledWith('image.crop', { elementId: el.id });

      const actionsId = imageElement.actions?.(el, undefined, { locale: 'id', emit } as never);
      expect(actionsId?.find((a) => a.id === 'image.crop')?.label).toBe('Potong gambar');
    });

    it('provides image.resetCrop action, active when crop is set, resetting crop to null', () => {
      const elWithCrop = makeImageElement({ crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
      const updateProps = vi.fn();
      const ctx = { locale: 'en', updateProps } as never;

      const actions = imageElement.actions?.(elWithCrop, undefined, ctx);
      const resetAction = actions?.find((a) => a.id === 'image.resetCrop');
      expect(resetAction).toBeDefined();
      expect(resetAction?.isActive?.()).toBe(true);
      expect(resetAction?.isEnabled?.()).toBe(true);
      expect(resetAction?.label).toBe('Reset crop');

      resetAction?.run();
      expect(updateProps).toHaveBeenCalledWith({ crop: null });

      // When crop is null, resetCrop should not be active
      const elNoCrop = makeImageElement({ crop: null });
      const actionsNoCrop = imageElement.actions?.(elNoCrop, undefined, ctx);
      const resetActionNoCrop = actionsNoCrop?.find((a) => a.id === 'image.resetCrop');
      expect(resetActionNoCrop?.isActive?.()).toBe(false);
      expect(resetActionNoCrop?.isEnabled?.()).toBe(false);
    });

    it('provides image.retry action, active on upload error, emitting image.retry', () => {
      const elError = makeImageElement({ uploadStatus: 'error', uploadError: 'Upload failed' });
      const emit = vi.fn();
      const ctx = { locale: 'en', emit } as never;

      const actions = imageElement.actions?.(elError, undefined, ctx);
      const retryAction = actions?.find((a) => a.id === 'image.retry');
      expect(retryAction).toBeDefined();
      expect(retryAction?.isActive?.()).toBe(true);
      expect(retryAction?.label).toBe('Retry upload');

      retryAction?.run();
      expect(emit).toHaveBeenCalledWith('image.retry', { elementId: elError.id });

      // When upload status is not error, retry is inactive
      const elReady = makeImageElement({ uploadStatus: 'ready' });
      const actionsReady = imageElement.actions?.(elReady, undefined, ctx);
      const retryActionReady = actionsReady?.find((a) => a.id === 'image.retry');
      expect(retryActionReady?.isActive?.()).toBe(false);
    });
  });

  describe('URL Sanitization (BOARD-2002)', () => {
    it('accepts valid safe URL schemes (https, http, blob, data raster image)', () => {
      expect(ALLOWED_IMAGE_SCHEMES).toEqual(['https:', 'http:', 'blob:', 'data:']);
      expect(sanitizeImageUrl('https://cdn.example.com/photo.jpg')).toBe('https://cdn.example.com/photo.jpg');
      expect(sanitizeImageUrl('http://assets.internal.net/img.png')).toBe('http://assets.internal.net/img.png');
      expect(sanitizeImageUrl('blob:https://example.com/264b3bf5-5e60-449e-b816-c38a19234856')).toBe(
        'blob:https://example.com/264b3bf5-5e60-449e-b816-c38a19234856',
      );
      expect(
        sanitizeImageUrl(
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        ),
      ).toContain('data:image/png;base64,');
    });

    it('rejects unsafe schemes and corrupted URLs', () => {
      expect(sanitizeImageUrl('javascript:alert(1)')).toBeNull();
      expect(sanitizeImageUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
      expect(sanitizeImageUrl('file:///etc/passwd')).toBeNull();
      expect(sanitizeImageUrl('ftp://example.com/photo.png')).toBeNull();
      expect(sanitizeImageUrl('https://example.com/with space.png')).toBeNull();
      expect(sanitizeImageUrl('')).toBeNull();
      expect(sanitizeImageUrl(null)).toBeNull();
    });
  });

  describe('Canvas Rendering', () => {
    it('renders uploading placeholder with progress bar and text', () => {
      const el = makeImageElement({ uploadStatus: 'uploading', uploadProgress: 45 });
      const { g, calls } = createMockCanvas();

      imageElement.render.canvas?.(
        g,
        el,
        undefined,
        { zoom: 1, compact: false },
        { locale: 'en', theme: { mode: 'light' } } as never,
      );

      expect(calls.some((c) => c.includes('fillRect'))).toBe(true);
      expect(calls.some((c) => c.includes('fillText(Uploading...'))).toBe(true);

      // Indonesian text
      const idCanvas = createMockCanvas();
      imageElement.render.canvas?.(
        idCanvas.g,
        el,
        undefined,
        { zoom: 1, compact: false },
        { locale: 'id', theme: { mode: 'light' } } as never,
      );
      expect(idCanvas.calls.some((c) => c.includes('fillText(Mengunggah...'))).toBe(true);
    });

    it('renders error placeholder on upload error', () => {
      const el = makeImageElement({ uploadStatus: 'error', uploadError: 'Ukuran file melebihi batas' });
      const { g, calls } = createMockCanvas();

      imageElement.render.canvas?.(
        g,
        el,
        undefined,
        { zoom: 1, compact: false },
        { locale: 'id', theme: { mode: 'light' } } as never,
      );

      expect(calls.some((c) => c.includes('fillText(!,'))).toBe(true);
      expect(calls.some((c) => c.includes('fillText(Ukuran file melebihi batas'))).toBe(true);
      expect(calls.some((c) => c.includes('fillText(Coba lagi unggah'))).toBe(true);
    });

    it('renders loading shimmer placeholder when image is loading in cache', () => {
      const el = makeImageElement({ assetId: 'pending-load' });
      const { g, calls } = createMockCanvas();

      const ctx: ElementContext = {
        locale: 'en',
        emit: vi.fn(),
        theme: { mode: 'light' } as never,
        resolveBrush: vi.fn() as never,
        assets: {
          resolve: () => new Promise(() => {}), // stays pending
        },
      };

      imageElement.render.canvas?.(g, el, undefined, { zoom: 1, compact: false }, ctx);
      expect(calls.some((c) => c.includes('fillText(Loading...'))).toBe(true);
    });

    it('renders error placeholder when asset resolution fails or URL is unsafe', () => {
      const el = makeImageElement({ assetId: 'unsafe-asset' });
      const { g, calls } = createMockCanvas();

      const ctx: ElementContext = {
        locale: 'en',
        emit: vi.fn(),
        theme: { mode: 'light' } as never,
        resolveBrush: vi.fn() as never,
        assets: {
          resolve: () => 'javascript:alert(1)', // unsafe URL
        },
      };

      imageElement.render.canvas?.(g, el, undefined, { zoom: 1, compact: false }, ctx);
      expect(calls.some((c) => c.includes('fillText(!,'))).toBe(true);
      expect(calls.some((c) => c.includes('fillText(Image unavailable'))).toBe(true);
    });

    it('renders loaded image without crop', () => {
      const mockImage = { width: 400, height: 300 } as CanvasImageSource;
      cacheLoadedImage('loaded-asset-1', mockImage);

      const el = makeImageElement({ assetId: 'loaded-asset-1', crop: null }, 320, 240);
      const { g, calls } = createMockCanvas();

      imageElement.render.canvas?.(
        g,
        el,
        undefined,
        { zoom: 1, compact: false },
        { locale: 'en' } as never,
      );

      expect(calls.some((c) => c.includes('clip()'))).toBe(true);
      expect(calls).toContain('drawImage([object],0,0,320,240)');
    });

    it('renders loaded image with normalized crop coordinates', () => {
      const mockImage = { width: 400, height: 200 } as CanvasImageSource;
      cacheLoadedImage('cropped-asset-1', mockImage);

      const el = makeImageElement(
        {
          assetId: 'cropped-asset-1',
          crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
        },
        320,
        240,
      );
      const { g, calls } = createMockCanvas();

      imageElement.render.canvas?.(
        g,
        el,
        undefined,
        { zoom: 1, compact: false },
        { locale: 'en' } as never,
      );

      // sx = 0.1 * 400 = 40
      // sy = 0.2 * 200 = 40
      // sw = 0.5 * 400 = 200
      // sh = 0.6 * 200 = 120
      expect(calls.some((c) => c.includes('clip()'))).toBe(true);
      expect(calls).toContain('drawImage([object],40,40,200,120,0,0,320,240)');
    });

    it('resolves image via ctx.getAsset metadata when assets.resolve is absent', () => {
      const mockImage = { width: 500, height: 500 } as CanvasImageSource;
      cacheLoadedImage('https://cdn.example.com/cat.jpg', mockImage);

      const el = makeImageElement({ assetId: 'asset-meta-1' }, 200, 200);
      const { g, calls } = createMockCanvas();

      const ctx: ElementContext = {
        locale: 'en',
        emit: vi.fn(),
        theme: { mode: 'light' } as never,
        resolveBrush: vi.fn() as never,
        getAsset: (id) =>
          id === 'asset-meta-1'
            ? {
                id: 'asset-meta-1',
                kind: 'asset',
                mimeType: 'image/jpeg',
                w: 500,
                h: 500,
                meta: { url: 'https://cdn.example.com/cat.jpg' },
              }
            : undefined,
      };

      imageElement.render.canvas?.(g, el, undefined, { zoom: 1, compact: false }, ctx);
      expect(calls).toContain('drawImage([object],0,0,200,200)');
    });
  });
});
