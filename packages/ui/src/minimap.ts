/**
 * Minimap component `<kujam-minimap>` (BOARD-1406).
 *
 * Renders a compact bird's-eye canvas (180 × 120) of page elements and camera viewport,
 * supports click-to-pan and viewport drag, and throttles render updates to avoid CPU waste.
 */

import type { Board, BoxBounds, ElementRecord, Point } from '@kujam/core';
import { createElementClass, type KujamUiElement, type UiWindow } from './base.js';
import { createIcon } from './icons.js';
import { tOr } from './i18n.js';

/**
 * Default size of the minimap in CSS pixels (BOARD-1406).
 *
 * @public
 */
export const MINIMAP_SIZE = Object.freeze({ width: 180, height: 120 });

/**
 * Smallest box enclosing every given box, skipping null or undefined entries (BOARD-1406).
 *
 * @public
 */
export function unionBounds(
  boxes: Iterable<BoxBounds | undefined | null>,
): BoxBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/**
 * Minimap custom element interface.
 *
 * @public
 */
export interface MinimapElement extends KujamUiElement {
  /** Total number of canvas render passes performed. */
  readonly renderCount: number;
  /** Collapses or expands the minimap. */
  toggle(): void;
  /** Immediately forces a canvas redraw. */
  renderNow(): void;
}

const MINIMAP_CSS = `
  :host {
    display: inline-block;
    user-select: none;
  }
  .container {
    position: relative;
    border-radius: var(--kujam-ui-radius-lg);
    background: var(--kujam-ui-surface);
    border: 1px solid var(--kujam-ui-border);
    box-shadow: var(--kujam-ui-shadow-float);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .header {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 2;
  }
  .toggle-btn {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--kujam-ui-radius-md);
    background: var(--kujam-ui-surface);
    color: var(--kujam-ui-ink-muted);
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    transition: opacity var(--kujam-ui-motion), background-color var(--kujam-ui-motion);
  }
  .toggle-btn:hover {
    background: var(--kujam-ui-surface-hover);
    color: var(--kujam-ui-ink);
  }
  .toggle-btn svg {
    transition: transform var(--kujam-ui-motion);
  }
  .canvas {
    display: block;
    width: 180px;
    height: 120px;
    cursor: crosshair;
  }
  .container.collapsed .canvas {
    display: none;
  }
  .container.collapsed {
    width: auto;
    height: auto;
  }
  .container.collapsed .header {
    position: static;
    padding: 2px;
  }
  .container.collapsed .toggle-btn svg {
    transform: rotate(180deg);
  }
`;

function panTo(board: Board, worldPoint: Point): void {
  const cam = board.camera as unknown as { panTo?: (pt: Point) => void };
  if (typeof cam.panTo === 'function') {
    cam.panTo(worldPoint);
  } else {
    const { zoom } = board.camera.get();
    const { width, height } = board.camera.viewport;
    const hw = width > 0 ? width / 2 / zoom : 0;
    const hh = height > 0 ? height / 2 / zoom : 0;
    board.camera.set({
      x: worldPoint.x - hw,
      y: worldPoint.y - hh,
    });
  }
}

function computeElementBounds(el: ElementRecord): BoxBounds {
  const x = typeof el.x === 'number' ? el.x : 0;
  const y = typeof el.y === 'number' ? el.y : 0;
  const elAny = el as unknown as { w?: number; h?: number };
  const w =
    typeof elAny.w === 'number'
      ? elAny.w
      : typeof el.props?.w === 'number'
        ? el.props.w
        : typeof el.props?.r === 'number'
          ? el.props.r * 2
          : 100;
  const h =
    typeof elAny.h === 'number'
      ? elAny.h
      : typeof el.props?.h === 'number'
        ? el.props.h
        : typeof el.props?.r === 'number'
          ? el.props.r * 2
          : 100;
  return {
    minX: x,
    minY: y,
    maxX: x + Math.max(0, w),
    maxY: y + Math.max(0, h),
  };
}

function getElementColor(el: ElementRecord, board: Board): string {
  const colorKey = typeof el.props?.color === 'string' ? el.props.color : undefined;
  if (colorKey) {
    const themeColors = board.theme?.colors as Record<string, string> | undefined;
    const stickyColors = board.theme?.sticky as Record<string, string> | undefined;
    if (themeColors && themeColors[colorKey]) return themeColors[colorKey];
    if (stickyColors && stickyColors[colorKey]) return stickyColors[colorKey];
    if (colorKey.startsWith('#') || colorKey.startsWith('rgb')) return colorKey;
  }
  return board.theme?.mode === 'dark' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.25)';
}

interface WorldMapping {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  scale: number;
}

function computeWorldBounds(board: Board): WorldMapping {
  const elements = board.query ? board.query() : [];
  const elementBoxes: BoxBounds[] = [];
  for (const el of elements) {
    elementBoxes.push(computeElementBounds(el));
  }
  const elementsUnion = unionBounds(elementBoxes);
  const vp = board.camera.getViewportBounds();
  const hasVp = vp.maxX > vp.minX && vp.maxY > vp.minY;
  const vpBox: BoxBounds = hasVp ? vp : { minX: 0, minY: 0, maxX: 800, maxY: 600 };

  const combined = unionBounds(elementsUnion ? [elementsUnion, vpBox] : [vpBox])!;

  let w = combined.maxX - combined.minX;
  let h = combined.maxY - combined.minY;
  if (w <= 0) w = 800;
  if (h <= 0) h = 600;

  const padX = Math.max(40, w * 0.1);
  const padY = Math.max(40, h * 0.1);

  let minX = combined.minX - padX;
  let maxX = combined.maxX + padX;
  let minY = combined.minY - padY;
  let maxY = combined.maxY + padY;

  const targetAspect = MINIMAP_SIZE.width / MINIMAP_SIZE.height;
  const currentW = maxX - minX;
  const currentH = maxY - minY;
  const currentAspect = currentW / currentH;

  if (currentAspect > targetAspect) {
    const targetH = currentW / targetAspect;
    const diff = targetH - currentH;
    minY -= diff / 2;
    maxY += diff / 2;
  } else {
    const targetW = currentH * targetAspect;
    const diff = targetW - currentW;
    minX -= diff / 2;
    maxX += diff / 2;
  }

  const scale = MINIMAP_SIZE.width / (maxX - minX);
  return { minX, minY, maxX, maxY, scale };
}

function renderMinimap(root: ShadowRoot, board: Board, host: HTMLElement): () => void {
  const doc = host.ownerDocument;
  const win = doc.defaultView ?? window;

  const container = doc.createElement('div');
  container.className = 'container';

  const header = doc.createElement('div');
  header.className = 'header';

  const toggleBtn = doc.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'toggle-btn';
  const icon = createIcon(doc, 'chevron', 14);
  if (icon) toggleBtn.append(icon);

  const updateToggleLabel = (): void => {
    const isCollapsed = container.classList.contains('collapsed');
    toggleBtn.setAttribute(
      'aria-label',
      isCollapsed
        ? tOr('minimap.expand', board, 'Expand minimap')
        : tOr('minimap.collapse', board, 'Minimize minimap'),
    );
  };
  updateToggleLabel();

  header.append(toggleBtn);
  container.append(header);

  const canvas = doc.createElement('canvas');
  canvas.width = MINIMAP_SIZE.width;
  canvas.height = MINIMAP_SIZE.height;
  canvas.className = 'canvas';
  container.append(canvas);

  root.append(container);

  let currentBounds: WorldMapping = computeWorldBounds(board);
  let currentVpRect: { x: number; y: number; w: number; h: number } | null = null;
  let renderCount = 0;
  let lastRenderTime = 0;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  function renderCanvas(): void {
    renderCount++;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    currentBounds = computeWorldBounds(board);
    const { minX, minY, scale } = currentBounds;

    ctx.clearRect(0, 0, MINIMAP_SIZE.width, MINIMAP_SIZE.height);

    // Muted background
    ctx.fillStyle =
      board.theme?.mode === 'dark' ? 'rgba(26, 28, 33, 0.95)' : 'rgba(255, 255, 255, 0.95)';
    ctx.fillRect(0, 0, MINIMAP_SIZE.width, MINIMAP_SIZE.height);

    // Draw elements
    const elements = board.query ? board.query() : [];
    for (const el of elements) {
      const box = computeElementBounds(el);
      const x = (box.minX - minX) * scale;
      const y = (box.minY - minY) * scale;
      const w = Math.max(2, (box.maxX - box.minX) * scale);
      const h = Math.max(2, (box.maxY - box.minY) * scale);
      const color = getElementColor(el, board);

      ctx.fillStyle = color;
      if (el.type === 'ellipse' || el.type === 'circle' || el.type?.includes('ellipse')) {
        ctx.beginPath();
        ctx.ellipse(
          x + w / 2,
          y + h / 2,
          Math.max(1, w / 2),
          Math.max(1, h / 2),
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      } else {
        ctx.fillRect(x, y, w, h);
      }
    }

    // Draw camera viewport overlay
    const vp = board.camera.getViewportBounds();
    if (vp.maxX > vp.minX && vp.maxY > vp.minY) {
      const vx = (vp.minX - minX) * scale;
      const vy = (vp.minY - minY) * scale;
      const vw = (vp.maxX - vp.minX) * scale;
      const vh = (vp.maxY - vp.minY) * scale;

      currentVpRect = { x: vx, y: vy, w: vw, h: vh };

      ctx.fillStyle =
        board.theme?.mode === 'dark'
          ? 'rgba(110, 160, 240, 0.2)'
          : 'rgba(47, 111, 219, 0.15)';
      ctx.fillRect(vx, vy, vw, vh);

      ctx.strokeStyle =
        board.theme?.mode === 'dark'
          ? 'rgba(110, 160, 240, 0.9)'
          : 'rgba(47, 111, 219, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vx, vy, vw, vh);
    } else {
      currentVpRect = null;
    }
  }

  const THROTTLE_INTERVAL_MS = 100;

  function scheduleRender(): void {
    if (container.classList.contains('collapsed')) return;
    if (renderTimer !== null) return;

    const now = Date.now();
    const elapsed = now - lastRenderTime;

    if (elapsed >= THROTTLE_INTERVAL_MS) {
      lastRenderTime = now;
      renderCanvas();
    } else {
      renderTimer = setTimeout(() => {
        renderTimer = null;
        lastRenderTime = Date.now();
        renderCanvas();
      }, THROTTLE_INTERVAL_MS - elapsed);
    }
  }

  function canvasToWorld(cx: number, cy: number): Point {
    return {
      x: currentBounds.minX + cx / currentBounds.scale,
      y: currentBounds.minY + cy / currentBounds.scale,
    };
  }

  function getCanvasCoords(e: PointerEvent | MouseEvent): Point {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? MINIMAP_SIZE.width / rect.width : 1;
    const scaleY = rect.height > 0 ? MINIMAP_SIZE.height / rect.height : 1;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  let isDragging = false;
  let dragCameraOffset: Point = { x: 0, y: 0 };

  const onPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    const { x: cx, y: cy } = getCanvasCoords(e);
    const clickWorld = canvasToWorld(cx, cy);

    const insideVp = Boolean(
      currentVpRect &&
        cx >= currentVpRect.x &&
        cx <= currentVpRect.x + currentVpRect.w &&
        cy >= currentVpRect.y &&
        cy <= currentVpRect.y + currentVpRect.h,
    );

    isDragging = true;

    if (insideVp) {
      const cam = board.camera.get();
      dragCameraOffset = {
        x: cam.x - clickWorld.x,
        y: cam.y - clickWorld.y,
      };
    } else {
      panTo(board, clickWorld);
      const cam = board.camera.get();
      dragCameraOffset = {
        x: cam.x - clickWorld.x,
        y: cam.y - clickWorld.y,
      };
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!isDragging) return;
    e.preventDefault();
    const { x: cx, y: cy } = getCanvasCoords(e);
    const curWorld = canvasToWorld(cx, cy);
    board.camera.set({
      x: curWorld.x + dragCameraOffset.x,
      y: curWorld.y + dragCameraOffset.y,
    });
  };

  const onPointerUp = (): void => {
    isDragging = false;
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  win.addEventListener('pointermove', onPointerMove);
  win.addEventListener('pointerup', onPointerUp);
  win.addEventListener('pointercancel', onPointerUp);

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isCollapsed = container.classList.toggle('collapsed');
    updateToggleLabel();
    if (!isCollapsed) {
      scheduleRender();
    }
  });

  // Initial draw
  renderCanvas();
  lastRenderTime = Date.now();

  const offCamera = board.on('camera', scheduleRender);
  const offChange = board.on('change', scheduleRender);
  const offTheme = board.on('theme', scheduleRender);

  // Attach methods to host
  const minimapEl = host as unknown as MinimapElement;
  minimapEl.toggle = () => toggleBtn.click();
  minimapEl.renderNow = () => renderCanvas();
  Object.defineProperty(minimapEl, 'renderCount', {
    get: () => renderCount,
    configurable: true,
  });

  return () => {
    if (renderTimer !== null) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    offCamera();
    offChange();
    offTheme();
    canvas.removeEventListener('pointerdown', onPointerDown);
    win.removeEventListener('pointermove', onPointerMove);
    win.removeEventListener('pointerup', onPointerUp);
    win.removeEventListener('pointercancel', onPointerUp);
  };
}

/**
 * Creates the `<kujam-minimap>` custom element class for a window (BOARD-1406).
 *
 * @internal
 */
export function createMinimapClass(win: UiWindow): new () => KujamUiElement {
  return createElementClass(win, { css: MINIMAP_CSS, render: renderMinimap });
}
