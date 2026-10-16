/**
 * BOARD-003 — prototipe sekali buang untuk memvalidasi Canvas 2D + lapisan HTML.
 *
 * Bukan kode produksi. Mengukur tiga pendekatan render dengan jalur kamera deterministik:
 * - `canvas`      : Canvas 2D, culling rbush, Path2D tercache, teks dilewati di zoom kecil.
 * - `svg`         : SVG penuh, satu `<g transform>` untuk kamera, tanpa culling.
 * - `canvas+html` : Canvas 2D di atas + 300 kartu HTML di satu lapisan dengan satu `transform` CSS,
 *                   opsional LOD (kartu digambar ringkas di canvas saat zoom < 0,4).
 */
import RBush from 'rbush';

// ---------- Parameter ----------

const params = new URLSearchParams(location.search);
const ELEMENT_COUNT = Number(params.get('n') ?? 5000);
const CARD_COUNT = Number(params.get('cards') ?? 300);
const DURATION_MS = Number(params.get('dur') ?? 6000);
const WARMUP_MS = 1000;
const WORLD_W = 16000;
const WORLD_H = 10000;
const LOD_ZOOM = 0.4;
const TEXT_MIN_ZOOM = 0.35;

// ---------- Data ----------

interface RectEl {
  kind: 'rect';
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  text: string;
}

interface StrokeEl {
  kind: 'stroke';
  id: number;
  points: number[];
  color: string;
  width: number;
}

type El = RectEl | StrokeEl;

interface Card {
  id: number;
  x: number;
  y: number;
  title: string;
  hue: number;
  status: string;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Indexed<T> extends BBox {
  item: T;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STICKY_FILLS = ['#fff3a3', '#ffd6a5', '#caffbf', '#9bf6ff', '#bdb2ff', '#ffc6ff'];
const INK = ['#1f2937', '#2563eb', '#dc2626', '#16a34a', '#9333ea'];
const WORDS = 'ide rencana catatan riset ulas jadwal konten desain revisi target minggu tim'.split(
  ' ',
);

/** Membuat dokumen JSON deterministik: 60% kotak sticky, 40% coretan 20 sampai 80 titik. */
function generateDocumentJson(): string {
  const rand = mulberry32(42);
  const elements: El[] = [];
  for (let i = 0; i < ELEMENT_COUNT; i++) {
    if (rand() < 0.6) {
      const w = 120 + rand() * 100;
      elements.push({
        kind: 'rect',
        id: i,
        x: rand() * (WORLD_W - w),
        y: rand() * (WORLD_H - w),
        w,
        h: w,
        fill: STICKY_FILLS[Math.floor(rand() * STICKY_FILLS.length)]!,
        text: `${WORDS[Math.floor(rand() * WORDS.length)]} ${WORDS[Math.floor(rand() * WORDS.length)]}`,
      });
    } else {
      const count = 20 + Math.floor(rand() * 60);
      let x = rand() * (WORLD_W - 400) + 200;
      let y = rand() * (WORLD_H - 400) + 200;
      let angle = rand() * Math.PI * 2;
      const points: number[] = [];
      for (let p = 0; p < count; p++) {
        angle += (rand() - 0.5) * 0.8;
        x += Math.cos(angle) * 6;
        y += Math.sin(angle) * 6;
        points.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
      }
      elements.push({
        kind: 'stroke',
        id: i,
        points,
        color: INK[Math.floor(rand() * INK.length)]!,
        width: 2 + rand() * 4,
      });
    }
  }
  return JSON.stringify({ version: 1, elements });
}

/** 300 kartu berkelompok di satu area (seperti papan perencanaan), grid 20 x 15. */
function generateCards(): Card[] {
  const rand = mulberry32(7);
  const statuses = ['Draf', 'Ditinjau', 'Siap', 'Terjadwal'];
  const cards: Card[] = [];
  const cols = 20;
  for (let i = 0; i < CARD_COUNT; i++) {
    cards.push({
      id: i,
      x: 2000 + (i % cols) * 300,
      y: 2000 + Math.floor(i / cols) * 260,
      title: `Kartu ${i + 1}: ${WORDS[Math.floor(rand() * WORDS.length)]} ${WORDS[Math.floor(rand() * WORDS.length)]}`,
      hue: Math.floor(rand() * 360),
      status: statuses[Math.floor(rand() * statuses.length)]!,
    });
  }
  return cards;
}

const CARD_W = 240;
const CARD_H = 150;
const CARDS_CENTER = { x: 2000 + (20 * 300) / 2, y: 2000 + (Math.ceil(CARD_COUNT / 20) * 260) / 2 };

function strokeBBox(points: number[], pad: number): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i]!;
    const y = points[i + 1]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function pathData(points: number[]): string {
  let d = `M${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) d += `L${points[i]} ${points[i + 1]}`;
  return d;
}

// ---------- Kamera ----------

interface Camera {
  x: number; // titik dunia di tengah layar
  y: number;
  z: number;
}

interface Renderer {
  render(cam: Camera): number; // mengembalikan jumlah elemen yang digambar
  dispose(): void;
}

const stage = document.getElementById('stage')!;

function viewportWorld(cam: Camera): BBox {
  const w = stage.clientWidth / cam.z;
  const h = stage.clientHeight / cam.z;
  return { minX: cam.x - w / 2, minY: cam.y - h / 2, maxX: cam.x + w / 2, maxY: cam.y + h / 2 };
}

// ---------- Renderer Canvas 2D ----------

/** Batas sisi canvas agar aman di iPad Safari (batas area canvas sekitar 16,7 juta piksel). */
const MAX_CANVAS_PIXELS = 16_000_000;

function createCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; dpr: number } {
  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);
  let dpr = window.devicePixelRatio || 1;
  const cssW = stage.clientWidth;
  const cssH = stage.clientHeight;
  if (cssW * cssH * dpr * dpr > MAX_CANVAS_PIXELS)
    dpr = Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH));
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  return { canvas, ctx, dpr };
}

/** Kebijakan tampilan kartu HTML. Dievaluasi sekali per frame oleh renderer canvas (yang jalan lebih dulu). */
interface HtmlPolicy {
  lod: boolean; // zoom < LOD_ZOOM: kartu ringkas di canvas, lapisan HTML disembunyikan
  cull: boolean; // kartu di luar viewport diberi display:none
  hideWhileZooming: boolean; // selama zoom berubah: kartu ringkas di canvas, HTML kembali 150 ms setelah zoom berhenti
  willChange: boolean;
  compact: boolean; // keadaan frame ini
  lastZ: number;
  lastZoomAt: number;
}

function updatePolicy(p: HtmlPolicy, cam: Camera): void {
  const now = performance.now();
  if (Math.abs(cam.z - p.lastZ) > 1e-4) p.lastZoomAt = now;
  p.lastZ = cam.z;
  p.compact = (p.lod && cam.z < LOD_ZOOM) || (p.hideWhileZooming && now - p.lastZoomAt < 150);
}

interface CanvasOptions {
  cull: boolean;
  cards?: Card[];
  policy?: HtmlPolicy;
}

function createCanvasRenderer(elements: El[], opts: CanvasOptions): Renderer {
  const { canvas, ctx, dpr } = createCanvas();
  const tree = new RBush<Indexed<El>>();
  const paths = new Map<number, Path2D>();
  const entries: Indexed<El>[] = elements.map((el) => {
    if (el.kind === 'rect') {
      return { minX: el.x, minY: el.y, maxX: el.x + el.w, maxY: el.y + el.h, item: el };
    }
    paths.set(el.id, new Path2D(pathData(el.points)));
    return { ...strokeBBox(el.points, el.width), item: el };
  });
  tree.load(entries);

  const cardTree = new RBush<Indexed<Card>>();
  if (opts.cards) {
    cardTree.load(
      opts.cards.map((c) => ({
        minX: c.x,
        minY: c.y,
        maxX: c.x + CARD_W,
        maxY: c.y + CARD_H,
        item: c,
      })),
    );
  }

  return {
    render(cam) {
      const cssW = stage.clientWidth;
      const cssH = stage.clientHeight;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#f6f5f2';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const s = dpr * cam.z;
      ctx.setTransform(
        s,
        0,
        0,
        s,
        dpr * (cssW / 2 - cam.x * cam.z),
        dpr * (cssH / 2 - cam.y * cam.z),
      );

      const visible = opts.cull ? tree.search(viewportWorld(cam)) : entries;
      const drawText = cam.z >= TEXT_MIN_ZOOM;
      const minScreen = 1.5 / cam.z; // di bawah ini elemen cukup jadi titik
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textBaseline = 'top';

      for (const entry of visible) {
        const el = entry.item;
        if (el.kind === 'rect') {
          ctx.fillStyle = el.fill;
          ctx.fillRect(el.x, el.y, el.w, el.h);
          if (drawText) {
            ctx.fillStyle = '#333';
            ctx.fillText(el.text, el.x + 10, el.y + 12, el.w - 20);
          }
        } else if (entry.maxX - entry.minX < minScreen && entry.maxY - entry.minY < minScreen) {
          ctx.fillStyle = el.color;
          ctx.fillRect(entry.minX, entry.minY, minScreen, minScreen);
        } else {
          ctx.strokeStyle = el.color;
          ctx.lineWidth = el.width;
          ctx.stroke(paths.get(el.id)!);
        }
      }

      let drawn = visible.length;
      // LOD: kartu digambar ringkas di canvas saat lapisan HTML disembunyikan.
      if (opts.policy) updatePolicy(opts.policy, cam);
      if (opts.cards && opts.policy?.compact) {
        const cards = cardTree.search(viewportWorld(cam));
        for (const { item: c } of cards) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(c.x, c.y, CARD_W, CARD_H);
          ctx.fillStyle = `hsl(${c.hue} 60% 75%)`;
          ctx.fillRect(c.x + 10, c.y + 10, CARD_W - 20, 62);
          ctx.fillStyle = '#9ca3af';
          ctx.fillRect(c.x + 10, c.y + 84, CARD_W - 60, 14);
          ctx.fillStyle = c.status === 'Siap' ? '#16a34a' : '#2563eb';
          ctx.beginPath();
          ctx.arc(c.x + CARD_W - 20, c.y + CARD_H - 20, 8, 0, Math.PI * 2);
          ctx.fill();
        }
        drawn += cards.length;
      }
      return drawn;
    },
    dispose() {
      canvas.remove();
    },
  };
}

// ---------- Lapisan HTML ----------

function createHtmlLayer(cards: Card[], policy: HtmlPolicy): Renderer {
  const layer = document.createElement('div');
  layer.className = 'html-layer';
  if (!policy.willChange) layer.style.willChange = 'auto';
  const nodes: HTMLDivElement[] = [];
  const shown = new Set<number>(cards.map((c) => c.id));
  const tree = new RBush<Indexed<Card>>();
  tree.load(
    cards.map((c) => ({ minX: c.x, minY: c.y, maxX: c.x + CARD_W, maxY: c.y + CARD_H, item: c })),
  );
  const frag = document.createDocumentFragment();
  for (const c of cards) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.left = `${c.x}px`;
    card.style.top = `${c.y}px`;
    card.innerHTML = `<div class="thumb" style="background:linear-gradient(135deg,hsl(${c.hue} 70% 80%),hsl(${(c.hue + 60) % 360} 70% 65%))"></div><div class="title"></div><div class="meta"><span class="badge"></span><span>Sen, 10:00</span><span class="avatar"></span></div>`;
    card.querySelector('.title')!.textContent = c.title;
    card.querySelector('.badge')!.textContent = c.status;
    nodes.push(card);
    frag.appendChild(card);
  }
  layer.appendChild(frag);
  stage.appendChild(layer);
  let hidden = false;

  return {
    render(cam) {
      const hide = policy.compact;
      if (hide !== hidden) {
        layer.style.display = hide ? 'none' : '';
        hidden = hide;
      }
      if (hide) return 0;
      const tx = stage.clientWidth / 2 - cam.x * cam.z;
      const ty = stage.clientHeight / 2 - cam.y * cam.z;
      layer.style.transform = `matrix(${cam.z},0,0,${cam.z},${tx},${ty})`;
      if (!policy.cull) return cards.length;
      const vp = viewportWorld(cam);
      const pad = 300;
      const visible = new Set(
        tree
          .search({
            minX: vp.minX - pad,
            minY: vp.minY - pad,
            maxX: vp.maxX + pad,
            maxY: vp.maxY + pad,
          })
          .map((e) => e.item.id),
      );
      for (const id of shown) if (!visible.has(id)) nodes[id]!.style.display = 'none';
      for (const id of visible) if (!shown.has(id)) nodes[id]!.style.display = '';
      shown.clear();
      for (const id of visible) shown.add(id);
      return visible.size;
    },
    dispose() {
      layer.remove();
    },
  };
}

// ---------- Renderer SVG penuh ----------

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgRenderer(elements: El[]): Renderer {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('font-family', 'system-ui, sans-serif');
  g.setAttribute('font-size', '16');
  for (const el of elements) {
    if (el.kind === 'rect') {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', String(el.x));
      r.setAttribute('y', String(el.y));
      r.setAttribute('width', String(el.w));
      r.setAttribute('height', String(el.h));
      r.setAttribute('fill', el.fill);
      g.appendChild(r);
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(el.x + 10));
      t.setAttribute('y', String(el.y + 28));
      t.setAttribute('fill', '#333');
      t.textContent = el.text;
      g.appendChild(t);
    } else {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', pathData(el.points));
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', el.color);
      p.setAttribute('stroke-width', String(el.width));
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      g.appendChild(p);
    }
  }
  svg.appendChild(g);
  stage.appendChild(svg);
  return {
    render(cam) {
      const tx = stage.clientWidth / 2 - cam.x * cam.z;
      const ty = stage.clientHeight / 2 - cam.y * cam.z;
      g.setAttribute('transform', `matrix(${cam.z},0,0,${cam.z},${tx},${ty})`);
      return elements.length;
    },
    dispose() {
      svg.remove();
    },
  };
}

// ---------- Skenario ----------

type Mode =
  | 'canvas'
  | 'canvas-nocull'
  | 'svg'
  | 'canvas+html'
  | 'canvas+html-nolod'
  | 'canvas+html-cull'
  | 'canvas+html-zoomhide'
  | 'canvas+html-nowc';

const HTML_POLICIES: Record<
  string,
  Pick<HtmlPolicy, 'lod' | 'cull' | 'hideWhileZooming' | 'willChange'>
> = {
  'canvas+html': { lod: true, cull: false, hideWhileZooming: false, willChange: true },
  'canvas+html-nolod': { lod: false, cull: false, hideWhileZooming: false, willChange: true },
  'canvas+html-cull': { lod: true, cull: true, hideWhileZooming: false, willChange: true },
  'canvas+html-zoomhide': { lod: true, cull: true, hideWhileZooming: true, willChange: true },
  'canvas+html-nowc': { lod: true, cull: false, hideWhileZooming: false, willChange: false },
};

interface Scenario {
  name: string;
  mode: Mode;
  camera(t: number): Camera; // t dalam 0..1 sepanjang durasi
}

const WORLD_CENTER = { x: WORLD_W / 2, y: WORLD_H / 2 };
const TAU = Math.PI * 2;

function panCircle(center: { x: number; y: number }, radius: number, z: number) {
  return (t: number): Camera => ({
    x: center.x + Math.cos(t * TAU) * radius,
    y: center.y + Math.sin(t * TAU) * radius * 0.6,
    z,
  });
}

function zoomSweep(center: { x: number; y: number }, zMin: number, zMax: number) {
  return (t: number): Camera => {
    const k = (1 - Math.cos(t * TAU)) / 2;
    return {
      x: center.x + Math.sin(t * TAU) * 300,
      y: center.y + Math.cos(t * TAU) * 200,
      z: Math.exp(Math.log(zMin) + (Math.log(zMax) - Math.log(zMin)) * k),
    };
  };
}

/** Zoom bertahap seperti wheel atau pinch: tiap segmen 200 ms animasi lalu 400 ms diam. */
function zoomSteps(center: { x: number; y: number }) {
  const levels = [1, 0.7, 0.5, 0.7, 1, 1.3, 1.5, 1.2, 1, 0.8, 1];
  const segments = levels.length - 1;
  return (t: number): Camera => {
    const f = t * segments;
    const i = Math.min(segments - 1, Math.floor(f));
    const local = (f - i) / 1; // 0..1 dalam segmen
    const k = Math.min(1, local / (1 / 3));
    const ease = k * k * (3 - 2 * k);
    const z = Math.exp(
      Math.log(levels[i]!) + (Math.log(levels[i + 1]!) - Math.log(levels[i]!)) * ease,
    );
    return { x: center.x + Math.sin(t * TAU) * 200, y: center.y, z };
  };
}

/** Zoom yang membuat seluruh dunia terlihat (kasus terburuk untuk culling). */
function fitAllZoom(): number {
  return Math.min(stage.clientWidth / WORLD_W, stage.clientHeight / WORLD_H) * 0.98;
}

const SCENARIOS: Scenario[] = [
  { name: 'canvas/pan-z1', mode: 'canvas', camera: panCircle(WORLD_CENTER, 3000, 1) },
  { name: 'canvas/zoom-sweep', mode: 'canvas', camera: zoomSweep(WORLD_CENTER, fitAllZoom(), 2) },
  {
    name: 'canvas/fit-all',
    mode: 'canvas',
    camera: (t) => ({ ...panCircle(WORLD_CENTER, 150, fitAllZoom())(t) }),
  },
  { name: 'canvas-nocull/pan-z1', mode: 'canvas-nocull', camera: panCircle(WORLD_CENTER, 3000, 1) },
  { name: 'svg/pan-z1', mode: 'svg', camera: panCircle(WORLD_CENTER, 3000, 1) },
  { name: 'svg/zoom-sweep', mode: 'svg', camera: zoomSweep(WORLD_CENTER, fitAllZoom(), 2) },
  {
    name: 'svg/fit-all',
    mode: 'svg',
    camera: (t) => ({ ...panCircle(WORLD_CENTER, 150, fitAllZoom())(t) }),
  },
  { name: 'html/pan-z1', mode: 'canvas+html', camera: panCircle(CARDS_CENTER, 1500, 1) },
  { name: 'html/pan-z035-lod', mode: 'canvas+html', camera: panCircle(CARDS_CENTER, 800, 0.35) },
  {
    name: 'html/pan-z035-nolod',
    mode: 'canvas+html-nolod',
    camera: panCircle(CARDS_CENTER, 800, 0.35),
  },
  { name: 'html/zoom-sweep-lod', mode: 'canvas+html', camera: zoomSweep(CARDS_CENTER, 0.2, 1.5) },
  {
    name: 'html/zoom-sweep-nolod',
    mode: 'canvas+html-nolod',
    camera: zoomSweep(CARDS_CENTER, 0.2, 1.5),
  },
  { name: 'html/zoom-steps-lod', mode: 'canvas+html', camera: zoomSteps(CARDS_CENTER) },
  {
    name: 'html-nowc/zoom-sweep',
    mode: 'canvas+html-nowc',
    camera: zoomSweep(CARDS_CENTER, 0.2, 1.5),
  },
  { name: 'html-nowc/zoom-steps', mode: 'canvas+html-nowc', camera: zoomSteps(CARDS_CENTER) },
  { name: 'html-cull/pan-z1', mode: 'canvas+html-cull', camera: panCircle(CARDS_CENTER, 1500, 1) },
  {
    name: 'html-cull/zoom-sweep',
    mode: 'canvas+html-cull',
    camera: zoomSweep(CARDS_CENTER, 0.2, 1.5),
  },
  { name: 'html-cull/zoom-steps', mode: 'canvas+html-cull', camera: zoomSteps(CARDS_CENTER) },
  {
    name: 'html-zoomhide/zoom-sweep',
    mode: 'canvas+html-zoomhide',
    camera: zoomSweep(CARDS_CENTER, 0.2, 1.5),
  },
  {
    name: 'html-zoomhide/zoom-steps',
    mode: 'canvas+html-zoomhide',
    camera: zoomSteps(CARDS_CENTER),
  },
];

// ---------- Pengukuran ----------

interface ScenarioResult {
  name: string;
  frames: number;
  avgFps: number;
  frameMs: { p50: number; p95: number; p99: number; max: number };
  scriptMs: { p50: number; p95: number; max: number };
  longFramePct: number; // persentase frame > 20 ms (melewati anggaran 60 fps)
  avgDrawn: number;
}

interface ModeResult {
  mode: Mode;
  loadMs: number; // JSON.parse sampai frame pertama tampil
  jsHeapMB: number | null;
  memorySource: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

async function measureRefreshInterval(): Promise<number> {
  const deltas: number[] = [];
  let prev = await nextFrame();
  for (let i = 0; i < 60; i++) {
    const now = await nextFrame();
    deltas.push(now - prev);
    prev = now;
  }
  deltas.sort((a, b) => a - b);
  return percentile(deltas, 50);
}

async function measureMemory(): Promise<{ mb: number | null; source: string }> {
  const perf = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
    memory?: { usedJSHeapSize: number };
  };
  if (perf.measureUserAgentSpecificMemory && crossOriginIsolated) {
    try {
      const res = await Promise.race([
        perf.measureUserAgentSpecificMemory(),
        new Promise<null>((r) => setTimeout(() => r(null), 8000)),
      ]);
      if (res)
        return { mb: round(res.bytes / 1048576, 1), source: 'measureUserAgentSpecificMemory' };
    } catch {
      // jatuh ke performance.memory
    }
  }
  if (perf.memory)
    return { mb: round(perf.memory.usedJSHeapSize / 1048576, 1), source: 'performance.memory' };
  return { mb: null, source: 'tidak tersedia di browser ini' };
}

const out = document.getElementById('out')!;
const log = (line: string) => {
  out.textContent += `${line}\n`;
};

let docJson = '';

async function buildMode(mode: Mode): Promise<{ renderers: Renderer[]; modeResult: ModeResult }> {
  stage.replaceChildren();
  await nextFrame();
  const t0 = performance.now();
  const doc = JSON.parse(docJson) as { elements: El[] };
  const renderers: Renderer[] = [];
  const cards = mode.startsWith('canvas+html') ? generateCards() : undefined;
  const base = HTML_POLICIES[mode];
  const policy: HtmlPolicy | undefined = base && {
    ...base,
    compact: false,
    lastZ: NaN,
    lastZoomAt: -Infinity,
  };
  if (mode === 'svg') {
    renderers.push(createSvgRenderer(doc.elements));
  } else {
    renderers.push(
      createCanvasRenderer(doc.elements, { cull: mode !== 'canvas-nocull', cards, policy }),
    );
    if (cards && policy) renderers.push(createHtmlLayer(cards, policy));
  }
  const cam = { x: WORLD_CENTER.x, y: WORLD_CENTER.y, z: 1 };
  for (const r of renderers) r.render(cam);
  await nextFrame();
  await nextFrame();
  const loadMs = performance.now() - t0;
  const mem = await measureMemory();
  return {
    renderers,
    modeResult: { mode, loadMs: round(loadMs, 1), jsHeapMB: mem.mb, memorySource: mem.source },
  };
}

async function runScenario(s: Scenario, renderers: Renderer[]): Promise<ScenarioResult> {
  const frameDeltas: number[] = [];
  const scriptTimes: number[] = [];
  let drawnTotal = 0;
  const start = await nextFrame();
  let prev = start;
  for (;;) {
    const now = await nextFrame();
    const elapsed = now - start;
    if (elapsed > WARMUP_MS + DURATION_MS) break;
    const t = ((elapsed - WARMUP_MS) / DURATION_MS + 1) % 1;
    const cam = s.camera(t);
    const t0 = performance.now();
    let drawn = 0;
    for (const r of renderers) drawn += r.render(cam);
    const script = performance.now() - t0;
    if (elapsed > WARMUP_MS) {
      frameDeltas.push(now - prev);
      scriptTimes.push(script);
      drawnTotal += drawn;
    }
    prev = now;
  }
  const fd = [...frameDeltas].sort((a, b) => a - b);
  const st = [...scriptTimes].sort((a, b) => a - b);
  const total = frameDeltas.reduce((a, b) => a + b, 0);
  return {
    name: s.name,
    frames: frameDeltas.length,
    avgFps: round((frameDeltas.length / total) * 1000, 1),
    frameMs: {
      p50: round(percentile(fd, 50)),
      p95: round(percentile(fd, 95)),
      p99: round(percentile(fd, 99)),
      max: round(fd[fd.length - 1] ?? 0),
    },
    scriptMs: {
      p50: round(percentile(st, 50)),
      p95: round(percentile(st, 95)),
      max: round(st[st.length - 1] ?? 0),
    },
    longFramePct: round((frameDeltas.filter((d) => d > 20).length / frameDeltas.length) * 100, 1),
    avgDrawn: Math.round(drawnTotal / Math.max(1, frameDeltas.length)),
  };
}

interface BenchReport {
  label: string;
  userAgent: string;
  dpr: number;
  viewport: { w: number; h: number };
  refreshMs: number;
  elementCount: number;
  cardCount: number;
  durationMs: number;
  modes: ModeResult[];
  scenarios: ScenarioResult[];
  finishedAt: string;
}

declare global {
  interface Window {
    __bench?: { done: boolean; report?: BenchReport; error?: string };
  }
}

async function runAll(label: string, only: string | null): Promise<BenchReport> {
  document.body.classList.add('running');
  out.textContent = '';
  window.__bench = { done: false };
  docJson = generateDocumentJson();
  const refreshMs = round(await measureRefreshInterval());
  log(
    `refresh ~${refreshMs} ms, dpr ${devicePixelRatio}, ${stage.clientWidth}x${stage.clientHeight}`,
  );

  const scenarios = SCENARIOS.filter((s) => !only || s.name.startsWith(only));
  const modes: ModeResult[] = [];
  const results: ScenarioResult[] = [];
  let current = null as { mode: Mode; renderers: Renderer[] } | null;
  for (const s of scenarios) {
    if (current?.mode !== s.mode) {
      current?.renderers.forEach((r) => r.dispose());
      const built = await buildMode(s.mode);
      current = { mode: s.mode, renderers: built.renderers };
      modes.push(built.modeResult);
      log(
        `[${s.mode}] muat ${built.modeResult.loadMs} ms, heap ${built.modeResult.jsHeapMB ?? '-'} MB`,
      );
    }
    const r = await runScenario(s, current.renderers);
    results.push(r);
    log(
      `${r.name}: ${r.avgFps} fps, p95 ${r.frameMs.p95} ms, skrip p95 ${r.scriptMs.p95} ms, digambar ~${r.avgDrawn}`,
    );
  }
  current?.renderers.forEach((r) => r.dispose());
  document.body.classList.remove('running');

  const report: BenchReport = {
    label,
    userAgent: navigator.userAgent,
    dpr: devicePixelRatio,
    viewport: { w: stage.clientWidth, h: stage.clientHeight },
    refreshMs,
    elementCount: ELEMENT_COUNT,
    cardCount: CARD_COUNT,
    durationMs: DURATION_MS,
    modes,
    scenarios: results,
    finishedAt: new Date().toISOString(),
  };
  try {
    await fetch('/__results', { method: 'POST', body: JSON.stringify(report) });
    log(`hasil disimpan sebagai results/${label}.json`);
  } catch {
    log('gagal mengirim hasil ke server');
  }
  window.__bench = { done: true, report };
  return report;
}

function defaultLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Firefox\//.test(ua)
    ? 'firefox'
    : /Chrome\//.test(ua)
      ? 'chrome'
      : /Safari\//.test(ua)
        ? 'safari'
        : 'browser';
  const device =
    /iPad|Macintosh.*Mobile|Macintosh/.test(ua) && navigator.maxTouchPoints > 1
      ? 'ipad'
      : /Mac/.test(ua)
        ? 'mac'
        : 'other';
  return `${browser}-${device}`;
}

const labelInput = document.getElementById('label') as HTMLInputElement;
labelInput.value = params.get('label') ?? defaultLabel();
document.getElementById('run-all')!.addEventListener('click', () => {
  void runAll(labelInput.value, params.get('only'));
});

if (params.get('auto') === '1') {
  runAll(labelInput.value, params.get('only')).catch((err: unknown) => {
    window.__bench = { done: true, error: String(err) };
  });
}
