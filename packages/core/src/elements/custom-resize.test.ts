import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createPresetResizeHandler,
  defineElement,
  definePlugin,
  object,
  resizeElements,
  type ElementRecord,
  type Point,
} from '../index.js';

describe('BOARD-1213: Custom element resize modes and presets', () => {
  it('enforces fixed-ratio resize mode on custom elements', () => {
    const fixedRatioEl = defineElement({
      type: 'custom-card',
      version: 1,
      props: object({}),
      resize: 'fixed-ratio',
    });
    const plugin = definePlugin({ id: 'test-fixed-ratio', elements: [fixedRatioEl] });
    const board = createBoard({ plugins: [plugin] });

    const el = board.create({
      id: 'c1',
      type: 'custom-card',
      x: 100,
      y: 100,
      w: 200,
      h: 100, // 2:1 ratio
    })!;

    // Drag SE corner by (+100, +20) -> w would be 300, max scale factor is 300/200 = 1.5, so h becomes 150 (2:1 kept)
    const start: Point = { x: 300, y: 200 };
    const current: Point = { x: 400, y: 220 };
    const [res] = resizeElements([el], 'se', start, current, { registry: board.elements });

    expect(res).toBeDefined();
    expect(res.w).toBe(300);
    expect(res.h).toBe(150);
    expect(res.w / res.h).toBeCloseTo(2);
  });

  it('enforces fixed-ratio resize mode from edge handles (scales both axes)', () => {
    const fixedRatioEl = defineElement({
      type: 'custom-badge',
      version: 1,
      props: object({}),
      resize: 'fixed-ratio',
    });
    const plugin = definePlugin({ id: 'test-fixed-edge', elements: [fixedRatioEl] });
    const board = createBoard({ plugins: [plugin] });

    const el = board.create({
      id: 'b1',
      type: 'custom-badge',
      x: 0,
      y: 0,
      w: 100,
      h: 100, // 1:1 ratio
    })!;

    // Drag E edge by +50px -> width becomes 150, fixed-ratio expands height to 150 centered
    const start: Point = { x: 100, y: 50 };
    const current: Point = { x: 150, y: 50 };
    const [res] = resizeElements([el], 'e', start, current, { registry: board.elements });

    expect(res).toBeDefined();
    expect(res.w).toBe(150);
    expect(res.h).toBe(150);
    expect(res.w / res.h).toBe(1);
  });

  it('enforces none resize mode to keep element dimensions completely fixed', () => {
    const fixedSizeEl = defineElement({
      type: 'fixed-avatar',
      version: 1,
      props: object({}),
      resize: 'none',
    });
    const plugin = definePlugin({ id: 'test-none-resize', elements: [fixedSizeEl] });
    const board = createBoard({ plugins: [plugin] });

    const el = board.create({
      id: 'av1',
      type: 'fixed-avatar',
      x: 50,
      y: 50,
      w: 64,
      h: 64,
    })!;

    // Dragging any handle should return unchanged dimensions
    const start: Point = { x: 114, y: 114 };
    const current: Point = { x: 250, y: 300 };
    const [res] = resizeElements([el], 'se', start, current, { registry: board.elements });

    expect(res).toBeDefined();
    expect(res.w).toBe(64);
    expect(res.h).toBe(64);
    expect(res.x).toBe(50);
    expect(res.y).toBe(50);
  });

  it('maps continuous handle dragging to discrete size presets (s, m, l)', () => {
    const presets = {
      s: { w: 160, h: 100 },
      m: { w: 240, h: 150 },
      l: { w: 320, h: 200 },
    };

    const cardWithPresets = defineElement({
      type: 'preset-card',
      version: 1,
      props: object({}),
      resize: createPresetResizeHandler(presets),
    });
    const plugin = definePlugin({ id: 'test-preset-resize', elements: [cardWithPresets] });
    const board = createBoard({ plugins: [plugin] });

    const el = board.create({
      id: 'pc1',
      type: 'preset-card',
      x: 0,
      y: 0,
      w: 160,
      h: 100, // Starts as 's'
    })!;

    // Drag slightly towards 'm' (e.g. proposed size 190x120 -> closer to 's' 160x100)
    let res = resizeElements(
      [el],
      'se',
      { x: 160, y: 100 },
      { x: 190, y: 120 },
      { registry: board.elements },
    )[0];
    expect(res.w).toBe(160);
    expect(res.h).toBe(100);

    // Drag closer to 'm' (e.g. proposed size 230x145 -> closer to 'm' 240x150)
    res = resizeElements(
      [el],
      'se',
      { x: 160, y: 100 },
      { x: 230, y: 145 },
      { registry: board.elements },
    )[0];
    expect(res.w).toBe(240);
    expect(res.h).toBe(150);

    // Drag closer to 'l' (e.g. proposed size 300x190 -> closer to 'l' 320x200)
    res = resizeElements(
      [el],
      'se',
      { x: 160, y: 100 },
      { x: 300, y: 190 },
      { registry: board.elements },
    )[0];
    expect(res.w).toBe(320);
    expect(res.h).toBe(200);
  });

  it('returns proposed size when createPresetResizeHandler is given empty presets', () => {
    const handler = createPresetResizeHandler({});
    const dummyRecord = { id: 'x', type: 'test', x: 0, y: 0, w: 100, h: 50, props: {} };
    const proposed = { w: 155, h: 82 };
    expect(handler(dummyRecord as unknown as ElementRecord<any>, proposed)).toBe(proposed);
  });

  it('handles multi-element resize containing mixed modes (fixed-ratio, none, and preset)', () => {
    const presets = {
      s: { w: 100, h: 100 },
      m: { w: 200, h: 200 },
    };

    const elFixed = defineElement({
      type: 'el-fixed',
      version: 1,
      props: object({}),
      resize: 'fixed-ratio',
    });
    const elNone = defineElement({
      type: 'el-none',
      version: 1,
      props: object({}),
      resize: 'none',
    });
    const elPreset = defineElement({
      type: 'el-preset',
      version: 1,
      props: object({}),
      resize: createPresetResizeHandler(presets),
    });

    const plugin = definePlugin({
      id: 'test-mixed-resize',
      elements: [elFixed, elNone, elPreset],
    });
    const board = createBoard({ plugins: [plugin] });

    const recFixed = board.create({ id: 'r1', type: 'el-fixed', x: 0, y: 0, w: 100, h: 50 })!;
    const recNone = board.create({ id: 'r2', type: 'el-none', x: 150, y: 0, w: 50, h: 50 })!;
    const recPreset = board.create({ id: 'r3', type: 'el-preset', x: 250, y: 0, w: 100, h: 100 })!;

    // Common bounding box: x: 0..350 (w: 350), y: 0..100 (h: 100)
    // Scale 2x from SE handle
    const results = resizeElements(
      [recFixed, recNone, recPreset],
      'se',
      { x: 350, y: 100 },
      { x: 700, y: 200 },
      { registry: board.elements },
    );

    const fixedRes = results.find((r) => r.id === 'r1')!;
    const noneRes = results.find((r) => r.id === 'r2')!;
    const presetRes = results.find((r) => r.id === 'r3')!;

    // Fixed-ratio element scaled 2x keeps ratio (200x100)
    expect(fixedRes.w).toBe(200);
    expect(fixedRes.h).toBe(100);
    expect(fixedRes.w / fixedRes.h).toBe(2);

    // None element keeps dimensions intact (50x50)
    expect(noneRes.w).toBe(50);
    expect(noneRes.h).toBe(50);

    // Preset element scales towards 200x200 and snaps to preset 'm' (200x200)
    expect(presetRes.w).toBe(200);
    expect(presetRes.h).toBe(200);
  });
});
