/**
 * Playwright helpers for the board test harness (BOARD-104, BOARD-2415): opening a scenario,
 * reading and seeding the board through `window.__board`, and pointer and keyboard input in board
 * coordinates.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { Board, CameraState, PartialElement, Point } from '../../packages/core/src/index.js';

declare global {
  interface Window {
    __board?: Board;
  }
}

export interface OpenBoardOptions {
  /** Playground scenario ID. Defaults to `harness`. */
  readonly scenario?: string;
  /** Extra query parameters of the scenario, for example `{ fixture: '0.1.0/kitchen-sink' }`. */
  readonly query?: Readonly<Record<string, string>>;
}

/** Opens a scenario in test mode and waits until its board is mounted. */
export async function openBoard(page: Page, options: OpenBoardOptions = {}): Promise<Locator> {
  const params = new URLSearchParams({ bare: '1', test: '1', ...options.query });
  await page.goto(`/s/${options.scenario ?? 'harness'}?${params}`);
  await page.locator('html[data-board-ready="true"]').waitFor();
  const root = boardRoot(page);
  await expect(root).toBeVisible();
  await nextFrame(page);
  return root;
}

/** The renderer's root element (canvas, HTML layer, and overlay). */
export function boardRoot(page: Page): Locator {
  return page.locator('.kujam-board-root');
}

/** Waits for two animation frames, so pending renders have been drawn. */
export async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** Creates elements through `board.create` and returns their IDs, then clears the history. */
export async function seed(page: Page, elements: readonly PartialElement[]): Promise<string[]> {
  const ids = await page.evaluate((list) => {
    const board = window.__board!;
    const out = list.map((el) => board.create(el)?.id ?? '');
    board.history.clear();
    return out;
  }, elements as PartialElement[]);
  await nextFrame(page);
  return ids;
}

/** A sticky note at `x, y` (200 × 200 unless given). */
export function sticky(id: string, x: number, y: number, size = 200): PartialElement {
  return { id, type: 'sticky', x, y, w: size, h: size, props: { text: [{ insert: `${id}\n` }] } };
}

export interface BoardSnapshot {
  readonly selection: readonly string[];
  readonly camera: CameraState;
  readonly tool: string | null;
  readonly elements: readonly {
    id: string;
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
    locked: boolean;
  }[];
  readonly canUndo: boolean;
}

/** Reads the board state that tests assert on. */
export function snapshot(page: Page): Promise<BoardSnapshot> {
  return page.evaluate(() => {
    const board = window.__board!;
    return {
      selection: [...board.selection],
      camera: { ...board.camera.get() },
      tool: board.tool,
      elements: board.query().map(({ id, type, x, y, w, h, rotation, locked }) => ({
        id,
        type,
        x,
        y,
        w,
        h,
        rotation,
        locked,
      })),
      canUndo: board.history.canUndo,
    };
  });
}

/** Element by ID from a snapshot; fails the test when missing. */
export function element(snap: BoardSnapshot, id: string): BoardSnapshot['elements'][number] {
  const el = snap.elements.find((e) => e.id === id);
  expect(el, `element ${id}`).toBeDefined();
  return el!;
}

/** Page (client) coordinates of a board point. */
export async function toPage(page: Page, point: Point): Promise<Point> {
  return page.evaluate((p) => {
    const board = window.__board!;
    const root = document.querySelector('.kujam-board-root')!.getBoundingClientRect();
    const s = board.camera.boardToScreen(p);
    return { x: root.left + s.x, y: root.top + s.y };
  }, point);
}

// ---------- Keyboard ----------

/** Modifier keys held during a pointer gesture. `Mod` is Cmd on macOS and Ctrl elsewhere. */
export type Modifier = 'Shift' | 'Alt' | 'Control' | 'Meta' | 'ControlOrMeta';

async function holding<T>(
  page: Page,
  modifiers: readonly Modifier[],
  fn: () => Promise<T>,
): Promise<T> {
  for (const m of modifiers) await page.keyboard.down(m);
  try {
    return await fn();
  } finally {
    for (const m of [...modifiers].reverse()) await page.keyboard.up(m);
  }
}

/** Focuses the board without changing its state, so keyboard shortcuts reach it. */
export async function focusBoard(page: Page): Promise<void> {
  await boardRoot(page).focus();
}

/**
 * The key `Mod` stands for on the board: Meta when the board runs as macOS, otherwise Control.
 * The board detects its platform from the user agent, which device emulation may set to another
 * OS than the host, so Playwright's own `ControlOrMeta` (the host's) cannot be used.
 */
export async function modKey(page: Page): Promise<'Meta' | 'Control'> {
  const label = await page.evaluate(() => window.__board!.keybindings.format('Mod+A'));
  return label.includes('⌘') ? 'Meta' : 'Control';
}

/**
 * Presses a shortcut on the focused board, then waits a frame. Uses Playwright key names, plus
 * `Mod` as in board keybindings, for example `Mod+Equal` or `Shift+Digit1`.
 */
export async function press(page: Page, shortcut: string): Promise<void> {
  const keys = shortcut.startsWith('Mod+')
    ? `${await modKey(page)}+${shortcut.slice(4)}`
    : shortcut;
  await page.keyboard.press(keys);
  await nextFrame(page);
}

// ---------- Mouse ----------

export interface GestureOptions {
  readonly modifiers?: readonly Modifier[];
  /** Intermediate pointer moves between points. Defaults to 8. */
  readonly steps?: number;
}

/** Clicks a board point with the mouse. */
export async function click(
  page: Page,
  at: Point,
  options: GestureOptions & { clickCount?: number } = {},
): Promise<void> {
  const p = await toPage(page, at);
  await holding(page, options.modifiers ?? [], () =>
    page.mouse.click(p.x, p.y, { clickCount: options.clickCount ?? 1 }),
  );
  await nextFrame(page);
}

/**
 * Presses at the first board point, moves through the others, and releases at the last one.
 * Board points are converted with the camera at the start of the gesture.
 */
export async function drag(
  page: Page,
  points: readonly Point[],
  options: GestureOptions = {},
): Promise<void> {
  const pagePoints = await Promise.all(points.map((p) => toPage(page, p)));
  const steps = options.steps ?? 8;
  await holding(page, options.modifiers ?? [], async () => {
    await page.mouse.move(pagePoints[0]!.x, pagePoints[0]!.y);
    await page.mouse.down();
    for (const p of pagePoints.slice(1)) await page.mouse.move(p.x, p.y, { steps });
    await page.mouse.up();
  });
  await nextFrame(page);
}

/** Scrolls the wheel over a board point. */
export async function wheel(
  page: Page,
  at: Point,
  delta: { x?: number; y?: number },
  options: GestureOptions = {},
): Promise<void> {
  const p = await toPage(page, at);
  await page.mouse.move(p.x, p.y);
  await holding(page, options.modifiers ?? [], () => page.mouse.wheel(delta.x ?? 0, delta.y ?? 0));
  await nextFrame(page);
}

// ---------- Pen and touch ----------

/** A point of a synthetic pointer stream; `pressure` is used for pens. */
export interface StreamPoint extends Point {
  readonly pressure?: number;
}

/**
 * Dispatches a synthetic Pointer Events stream on the board canvas for pointer types that
 * Playwright cannot drive in every browser: pens with pressure, and touches (ADR-004). Each
 * entry of `pointers` is the path of one pointer in board coordinates, converted with the camera
 * at the start of the gesture; all pointers go down together, move in lockstep, and go up
 * together.
 */
export async function pointerStream(
  page: Page,
  pointerType: 'pen' | 'touch',
  pointers: readonly (readonly StreamPoint[])[],
): Promise<void> {
  await page.evaluate(
    ({ type, paths }) => {
      const board = window.__board!;
      const root = document.querySelector('.kujam-board-root')!;
      const canvas = root.querySelector('canvas')!;
      const rect = root.getBoundingClientRect();
      // Converted up front: the gesture may move the camera (touch pan, pinch).
      const screenPaths = paths.map((path) =>
        path.map((p) => ({ ...p, ...board.camera.boardToScreen(p) })),
      );
      const fire = (
        name: string,
        id: number,
        s: { x: number; y: number; pressure?: number },
        down: boolean,
      ) => {
        canvas.dispatchEvent(
          new PointerEvent(name, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 100 + id,
            pointerType: type,
            isPrimary: id === 0,
            clientX: rect.left + s.x,
            clientY: rect.top + s.y,
            button: name === 'pointermove' ? -1 : 0,
            buttons: down ? 1 : 0,
            pressure: down ? (s.pressure ?? 0.5) : 0,
            width: type === 'touch' ? 10 : 1,
            height: type === 'touch' ? 10 : 1,
          }),
        );
      };
      const length = Math.max(...screenPaths.map((path) => path.length));
      const at = (path: readonly { x: number; y: number }[], i: number) =>
        path[Math.min(i, path.length - 1)]!;
      screenPaths.forEach((path, id) => fire('pointerdown', id, path[0]!, true));
      for (let i = 1; i < length; i++)
        screenPaths.forEach((path, id) => fire('pointermove', id, at(path, i), true));
      screenPaths.forEach((path, id) => fire('pointerup', id, at(path, length - 1), false));
    },
    { type: pointerType, paths: pointers as StreamPoint[][] },
  );
  await nextFrame(page);
}

/** Straight path from `a` to `b` in `steps` segments. */
export function line(
  a: Point,
  b: Point,
  steps = 10,
  pressure?: (t: number) => number,
): StreamPoint[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      ...(pressure ? { pressure: pressure(t) } : {}),
    };
  });
}
