/**
 * Performance HUD and visual debug overlays for the @kujam playground (BOARD-2406).
 *
 * Displays a floating telemetry-free metrics panel and renders canvas debug overlays:
 * - Realtime FPS and frame times (rolling average & p95 over last 60 frames).
 * - Viewport culling counters (elements drawn vs culled).
 * - HTML DOM nodes count in .kujam-html-layer.
 * - JS heap memory allocation when supported by the host runtime.
 * - Visual debug toggles: bounding boxes, snap points / spatial index, dirty rectangles.
 */

import {
  computeElementAABB,
  resolveElementGeometry,
  snapPoints,
  type Board,
  type BoxBounds,
  type ChangeEvent,
} from '@kujam/core';
import type { BoardView } from '@kujam/renderer';

export interface PerformanceHud {
  readonly element: HTMLElement;
  dispose(): void;
}

interface DirtyRectEntry {
  readonly bounds: BoxBounds;
  readonly timestamp: number;
}

interface HudState {
  boundingBoxes: boolean;
  snapPoints: boolean;
  dirtyRects: boolean;
  collapsed: boolean;
}

/**
 * Creates and mounts a floating performance HUD in the stage element.
 *
 * @param board - The active board instance.
 * @param stage - The stage DOM element hosting the board view.
 */
export function createPerformanceHud(board: Board, stage: HTMLElement): PerformanceHud {
  const doc = stage.ownerDocument;
  const win = doc.defaultView ?? window;

  const state: HudState = {
    boundingBoxes: false,
    snapPoints: false,
    dirtyRects: false,
    collapsed: false,
  };

  // Rolling buffer for frame delta durations (last 60 frames)
  const frameDeltas: number[] = [];
  const MAX_FRAMES = 60;
  let lastFrameTimestamp = performance.now();
  let rafId: number | null = null;
  let disposed = false;

  // Active dirty rectangles buffer for visual decay
  const dirtyRects: DirtyRectEntry[] = [];
  const DIRTY_DECAY_MS = 800;

  // 1. Create transparent debug overlay canvas inside stage
  const overlayCanvas = doc.createElement('canvas');
  overlayCanvas.className = 'kujam-hud-debug-overlay';
  overlayCanvas.setAttribute('aria-hidden', 'true');
  Object.assign(overlayCanvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '998',
  });
  stage.appendChild(overlayCanvas);

  const ctx = overlayCanvas.getContext('2d');

  function resizeCanvas(): void {
    const dpr = win.devicePixelRatio || 1;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (overlayCanvas.width !== width * dpr || overlayCanvas.height !== height * dpr) {
      overlayCanvas.width = width * dpr;
      overlayCanvas.height = height * dpr;
    }
  }

  const resizeObserver = typeof win.ResizeObserver === 'function'
    ? new win.ResizeObserver(() => resizeCanvas())
    : null;
  resizeObserver?.observe(stage);
  resizeCanvas();

  // 2. Create floating HUD DOM overlay
  const hudElement = doc.createElement('div');
  hudElement.className = 'kujam-performance-hud';
  hudElement.dataset.kujamHud = '';
  Object.assign(hudElement.style, {
    position: 'absolute',
    top: '12px',
    right: '12px',
    zIndex: '1000',
    minWidth: '280px',
    maxWidth: '340px',
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid rgba(255, 255, 255, 0.16)',
    borderRadius: '10px',
    padding: '10px 12px',
    color: '#f8fafc',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '11px',
    lineHeight: '1.5',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
    userSelect: 'none',
    pointerEvents: 'auto',
  });

  // Top header row: Title & collapse button
  const headerRow = doc.createElement('div');
  Object.assign(headerRow.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
    paddingBottom: '4px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
  });

  const title = doc.createElement('strong');
  title.textContent = '⚡ HUD Performa';
  title.style.color = '#38bdf8';

  const collapseBtn = doc.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.textContent = '−';
  collapseBtn.setAttribute('aria-label', 'Perkecil HUD');
  Object.assign(collapseBtn.style, {
    background: 'transparent',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '4px',
    color: '#cbd5e1',
    cursor: 'pointer',
    padding: '0 6px',
    fontSize: '12px',
    lineHeight: '16px',
  });
  collapseBtn.addEventListener('click', () => {
    state.collapsed = !state.collapsed;
    contentBody.style.display = state.collapsed ? 'none' : 'flex';
    collapseBtn.textContent = state.collapsed ? '+' : '−';
    collapseBtn.setAttribute('aria-label', state.collapsed ? 'Perbesar HUD' : 'Perkecil HUD');
  });

  headerRow.append(title, collapseBtn);

  // Content body
  const contentBody = doc.createElement('div');
  Object.assign(contentBody.style, {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  });

  // Metric fields
  const fpsText = doc.createElement('div');
  const frameTimeText = doc.createElement('div');
  const elementsCountText = doc.createElement('div');
  const domNodesText = doc.createElement('div');
  const heapMemoryText = doc.createElement('div');

  contentBody.append(fpsText, frameTimeText, elementsCountText, domNodesText, heapMemoryText);

  // Toggles section
  const togglesDivider = doc.createElement('hr');
  Object.assign(togglesDivider.style, {
    border: '0',
    borderTop: '1px solid rgba(255, 255, 255, 0.12)',
    margin: '4px 0',
  });
  contentBody.appendChild(togglesDivider);

  const togglesTitle = doc.createElement('div');
  togglesTitle.textContent = 'Overlay Debug:';
  togglesTitle.style.color = '#94a3b8';
  togglesTitle.style.fontWeight = '600';
  contentBody.appendChild(togglesTitle);

  function createToggle(
    label: string,
    initialChecked: boolean,
    onChange: (checked: boolean) => void,
  ): HTMLElement {
    const labelEl = doc.createElement('label');
    Object.assign(labelEl.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      cursor: 'pointer',
      fontSize: '11px',
      color: '#e2e8f0',
    });

    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = initialChecked;
    checkbox.style.cursor = 'pointer';
    checkbox.style.accentColor = '#38bdf8';

    checkbox.addEventListener('change', () => {
      onChange(checkbox.checked);
      drawDebugOverlay();
    });

    labelEl.append(checkbox, doc.createTextNode(label));
    return labelEl;
  }

  const boundToggle = createToggle('Kotak pembatas (Bounding box)', state.boundingBoxes, (checked) => {
    state.boundingBoxes = checked;
  });

  const snapToggle = createToggle('Titik snap & indeks spasial', state.snapPoints, (checked) => {
    state.snapPoints = checked;
  });

  const dirtyToggle = createToggle('Indikator dirty rect', state.dirtyRects, (checked) => {
    state.dirtyRects = checked;
    const view = (stage as unknown as { __kujamView?: BoardView }).__kujamView;
    if (view) {
      view.debug = checked;
    }
  });

  contentBody.append(boundToggle, snapToggle, dirtyToggle);
  hudElement.append(headerRow, contentBody);
  stage.appendChild(hudElement);

  // 3. Track dirty rectangles from board mutations
  function recordDirtyBounds(bounds: BoxBounds): void {
    const now = performance.now();
    dirtyRects.push({ bounds, timestamp: now });
  }

  const offChange = board.on('change', (event: ChangeEvent) => {
    if (!state.dirtyRects) return;
    for (const record of Object.values(event.added)) {
      if (record.kind === 'element') {
        const b = board.spatial.getBounds(record.id) ?? computeElementAABB(record);
        recordDirtyBounds(b);
      }
    }
    for (const record of Object.values(event.removed)) {
      if (record.kind === 'element') {
        recordDirtyBounds({ minX: record.x, minY: record.y, maxX: record.x + record.w, maxY: record.y + record.h });
      }
    }
    for (const { before, after } of Object.values(event.updated)) {
      if (after.kind === 'element') {
        const bAfter = board.spatial.getBounds(after.id) ?? computeElementAABB(after);
        if (before.kind === 'element') {
          const bBefore = computeElementAABB(before);
          recordDirtyBounds({
            minX: Math.min(bBefore.minX, bAfter.minX),
            minY: Math.min(bBefore.minY, bAfter.minY),
            maxX: Math.max(bBefore.maxX, bAfter.maxX),
            maxY: Math.max(bBefore.maxY, bAfter.maxY),
          });
        } else {
          recordDirtyBounds(bAfter);
        }
      }
    }
  });

  // 4. Debug overlay rendering
  function drawDebugOverlay(): void {
    if (!ctx) return;
    const dpr = win.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const hasAnyOverlay = state.boundingBoxes || state.snapPoints || (state.dirtyRects && dirtyRects.length > 0);
    if (!hasAnyOverlay) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    const camera = board.camera;
    const viewport = camera.getViewportBounds();
    const visibleElements = board.query({ inBounds: viewport });
    const now = performance.now();

    // A. Bounding Boxes Overlay
    if (state.boundingBoxes) {
      ctx.lineWidth = 1.5;
      for (const el of visibleElements) {
        const bounds = board.spatial.getBounds(el.id) ?? computeElementAABB(el);
        const s1 = camera.boardToScreen({ x: bounds.minX, y: bounds.minY });
        const s2 = camera.boardToScreen({ x: bounds.maxX, y: bounds.maxY });
        const sw = Math.abs(s2.x - s1.x);
        const sh = Math.abs(s2.y - s1.y);
        const sx = Math.min(s1.x, s2.x);
        const sy = Math.min(s1.y, s2.y);

        // AABB outline
        ctx.strokeStyle = '#10b981'; // Emerald
        ctx.fillStyle = 'rgba(16, 185, 129, 0.05)';
        if (typeof ctx.setLineDash === 'function') ctx.setLineDash([3, 3]);
        ctx.fillRect(sx, sy, sw, sh);
        ctx.strokeRect(sx, sy, sw, sh);

        // Element label badge
        ctx.fillStyle = '#10b981';
        ctx.font = '10px ui-monospace, SFMono-Regular, monospace';
        if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
        ctx.fillText(`${el.type}#${el.id} (${Math.round(el.w)}×${Math.round(el.h)})`, sx + 4, Math.max(12, sy - 4));
      }
    }

    // B. Snap Points & Spatial Index Overlay
    if (state.snapPoints) {
      for (const el of visibleElements) {
        // Draw spatial index box (purple)
        const spatialBounds = board.spatial.getBounds(el.id);
        if (spatialBounds) {
          const s1 = camera.boardToScreen({ x: spatialBounds.minX, y: spatialBounds.minY });
          const s2 = camera.boardToScreen({ x: spatialBounds.maxX, y: spatialBounds.maxY });
          const sw = Math.abs(s2.x - s1.x);
          const sh = Math.abs(s2.y - s1.y);
          const sx = Math.min(s1.x, s2.x);
          const sy = Math.min(s1.y, s2.y);

          ctx.strokeStyle = '#a855f7'; // Purple
          ctx.lineWidth = 1;
          if (typeof ctx.setLineDash === 'function') ctx.setLineDash([2, 4]);
          ctx.strokeRect(sx, sy, sw, sh);
        }

        // Draw individual snap points
        let geom;
        try {
          geom = resolveElementGeometry(el);
        } catch {
          geom = undefined;
        }

        if (geom) {
          const points = snapPoints(geom, el);
          for (const pt of points) {
            const screenPt = camera.boardToScreen(pt);
            if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);

            if (pt.kind === 'corner') {
              ctx.fillStyle = '#ec4899'; // Pink diamond
              ctx.beginPath();
              ctx.arc(screenPt.x, screenPt.y, 3.5, 0, Math.PI * 2);
              ctx.fill();
            } else if (pt.kind === 'edge') {
              ctx.strokeStyle = '#06b6d4'; // Cyan cross
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(screenPt.x - 3, screenPt.y);
              ctx.lineTo(screenPt.x + 3, screenPt.y);
              ctx.moveTo(screenPt.x, screenPt.y - 3);
              ctx.lineTo(screenPt.x, screenPt.y + 3);
              ctx.stroke();
            } else {
              ctx.fillStyle = '#f59e0b'; // Amber center dot
              ctx.beginPath();
              ctx.arc(screenPt.x, screenPt.y, 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
    }

    // C. Dirty Rectangles Overlay
    if (state.dirtyRects && dirtyRects.length > 0) {
      for (let i = dirtyRects.length - 1; i >= 0; i--) {
        const item = dirtyRects[i]!;
        const age = now - item.timestamp;
        if (age > DIRTY_DECAY_MS) {
          dirtyRects.splice(i, 1);
          continue;
        }

        const opacity = Math.max(0, 1 - age / DIRTY_DECAY_MS);
        const s1 = camera.boardToScreen({ x: item.bounds.minX, y: item.bounds.minY });
        const s2 = camera.boardToScreen({ x: item.bounds.maxX, y: item.bounds.maxY });
        const sw = Math.abs(s2.x - s1.x);
        const sh = Math.abs(s2.y - s1.y);
        const sx = Math.min(s1.x, s2.x);
        const sy = Math.min(s1.y, s2.y);

        ctx.fillStyle = `rgba(239, 68, 68, ${0.2 * opacity})`;
        ctx.strokeStyle = `rgba(239, 68, 68, ${0.9 * opacity})`;
        ctx.lineWidth = 2;
        if (typeof ctx.setLineDash === 'function') ctx.setLineDash([4, 4]);
        ctx.fillRect(sx, sy, sw, sh);
        ctx.strokeRect(sx, sy, sw, sh);

        ctx.fillStyle = `rgba(239, 68, 68, ${opacity})`;
        ctx.font = '10px ui-monospace, SFMono-Regular, monospace';
        if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
        ctx.fillText(`dirty: ${Math.round(sw)}×${Math.round(sh)}`, sx + 4, sy + 12);
      }
    }

    ctx.restore();
  }

  // 5. Update Telemetry-Free Metrics
  let frameCounter = 0;

  function updateMetrics(fps: number, avgFrameTime: number, p95FrameTime: number): void {
    // FPS with visual color indicator
    const fpsVal = Math.round(fps);
    const fpsColor = fpsVal >= 55 ? '#4ade80' : fpsVal >= 30 ? '#facc15' : '#f87171';
    fpsText.innerHTML = `FPS: <span style="color: ${fpsColor}; font-weight: bold;">${fpsVal}</span>`;

    // Frame times (rolling average & p95)
    frameTimeText.textContent = `Waktu Frame: ${avgFrameTime.toFixed(1)} ms (rata-rata) · ${p95FrameTime.toFixed(1)} ms (p95)`;

    // Elements drawn vs culled count in viewport
    const viewportBounds = board.camera.getViewportBounds();
    const totalElements = board.query().length;
    const hasSize = viewportBounds.maxX > viewportBounds.minX && viewportBounds.maxY > viewportBounds.minY;
    const drawnCount = hasSize ? board.spatial.search(viewportBounds).length : totalElements;
    const culledCount = Math.max(0, totalElements - drawnCount);
    elementsCountText.textContent = `Elemen: ${drawnCount} dirender · ${culledCount} dicull (${totalElements} total)`;

    // HTML DOM nodes count in .kujam-html-layer
    const htmlLayer = stage.querySelector('.kujam-html-layer, [data-kujam-layer="html"]');
    const domCount = htmlLayer ? htmlLayer.querySelectorAll('*').length : 0;
    domNodesText.textContent = `Node DOM HTML: ${domCount} node`;

    // JS Heap memory if available
    const perfWithMemory = performance as unknown as {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };

    if (perfWithMemory.memory) {
      const usedMB = (perfWithMemory.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
      const totalMB = (perfWithMemory.memory.totalJSHeapSize / (1024 * 1024)).toFixed(1);
      heapMemoryText.textContent = `Memori Heap: ${usedMB} MB / ${totalMB} MB`;
    } else {
      heapMemoryText.textContent = 'Memori Heap: Tidak tersedia (hanya Chromium)';
    }
  }

  // 6. Animation loop
  function loop(): void {
    if (disposed) return;
    const now = performance.now();
    const delta = now - lastFrameTimestamp;
    lastFrameTimestamp = now;

    if (delta > 0 && delta < 1000) {
      frameDeltas.push(delta);
      if (frameDeltas.length > MAX_FRAMES) frameDeltas.shift();
    }

    // Compute metrics
    const sum = frameDeltas.reduce((a, b) => a + b, 0);
    const avg = frameDeltas.length > 0 ? sum / frameDeltas.length : 16.6;
    const fps = avg > 0 ? 1000 / avg : 60;

    const sorted = [...frameDeltas].sort((a, b) => a - b);
    const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    const p95 = sorted[p95Index] ?? avg;

    // Throttle DOM text updates to every 6 frames for performance
    frameCounter++;
    if (frameCounter % 6 === 0) {
      updateMetrics(fps, avg, p95);
    }

    // Redraw debug overlays
    drawDebugOverlay();

    rafId = requestAnimationFrame(loop);
  }

  rafId = requestAnimationFrame(loop);

  // Initial immediate metric update
  updateMetrics(60, 16.6, 16.6);

  return {
    element: hudElement,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      offChange();
      resizeObserver?.disconnect();
      hudElement.remove();
      overlayCanvas.remove();

      const view = (stage as unknown as { __kujamView?: BoardView }).__kujamView;
      if (view) {
        view.debug = false;
      }
    },
  };
}
