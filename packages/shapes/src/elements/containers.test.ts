import { describe, expect, it, vi } from 'vitest';
import { createBoard, definePlugin } from '@kujam/core';
import { groupElement } from './group.js';
import { frameElement, DEFAULT_FRAME_SIZE } from './frame.js';
import { frameTool } from '../tools/frame.js';
import { selectTool } from '../tools/select.js';

const containersPlugin = definePlugin({
  id: 'containers-plugin',
  elements: [groupElement, frameElement],
  tools: [selectTool, frameTool],
});

describe('BOARD-1104 & BOARD-1105: Shapes Group and Frame Elements', () => {
  it('defines group element with valid schemas and a11y', () => {
    expect(groupElement.type).toBe('group');
    expect(groupElement.resize).toBe('free');

    const board = createBoard({ plugins: [containersPlugin] });
    const group = board.create({ type: 'group', x: 0, y: 0, w: 100, h: 100, props: {} })!;
    expect(group).toBeDefined();

    const a11yEn = groupElement.a11y?.(group, undefined, { locale: 'en' } as never);
    expect(a11yEn?.role).toBe('group');
    expect(a11yEn?.label).toBe('Group');

    const a11yId = groupElement.a11y?.(group, undefined, { locale: 'id' } as never);
    expect(a11yId?.label).toBe('Grup');
  });

  it('defines frame element with properties, actions, and rendering', () => {
    expect(frameElement.type).toBe('frame');
    expect(DEFAULT_FRAME_SIZE).toEqual({ w: 800, h: 600 });

    const board = createBoard({ plugins: [containersPlugin] });
    const frame = board.create({
      type: 'frame',
      x: 0,
      y: 0,
      w: 800,
      h: 600,
      props: { name: 'Presentation Slide 1', fill: 'surface', clip: true },
    })!;

    expect(frame.props.name).toBe('Presentation Slide 1');
    expect(frame.props.clip).toBe(true);

    // Double click emits edit
    const emit = vi.fn();
    frameElement.onDoubleClick?.(frame, { emit, locale: 'en' } as never);
    expect(emit).toHaveBeenCalledWith('edit', { id: frame.id });

    // Actions toggle clip
    const actions = frameElement.actions?.(frame, undefined, { locale: 'en' } as never);
    const clipAction = actions?.find((a) => a.id === 'frame.clip');
    expect(clipAction).toBeDefined();
    expect(clipAction?.checked).toBe(true);

    clipAction?.run(board);
    expect(board.getElement(frame.id)!.props.clip).toBe(false);

    // Canvas render should draw background, border, and title
    const ctx = {
      beginPath: vi.fn(),
      rect: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
    };

    frameElement.render.canvas?.(
      ctx as never,
      frame,
      undefined,
      { zoom: 1 } as never,
      { theme: { mode: 'light' } } as never,
    );

    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith('Presentation Slide 1', 2, -6);
  });

  it('creates frames with sequential names and auto-parents enclosed elements', () => {
    const board = createBoard({ plugins: [containersPlugin] });
    // An element already on canvas
    const inner = board.create({ type: 'frame', x: 50, y: 50, w: 100, h: 100, props: { name: 'Child' } })!;

    board.setTool('frame');

    const downEvent = {
      type: 'pointer-down' as const,
      pointerId: 1,
      pointerType: 'mouse' as const,
      point: { x: 0, y: 0 },
      screen: { x: 0, y: 0 },
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 1,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    };

    const upEvent = {
      type: 'pointer-up' as const,
      pointerId: 1,
      pointerType: 'mouse' as const,
      point: { x: 0, y: 0 },
      screen: { x: 0, y: 0 },
      pressure: 0,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 0,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    };

    board.dispatch(downEvent);
    board.dispatch(upEvent);

    const frames = board.query({ type: 'frame' });
    expect(frames.length).toBe(2);

    const createdFrame = frames.find((f) => f.id !== inner.id)!;
    expect(createdFrame.props.name).toBe('Frame 2');

    // inner was at (50, 50, 100, 100), enclosed in (0, 0, 800, 600)
    expect(board.getElement(inner.id)!.parentId).toBe(createdFrame.id);

    // Active tool should have switched to select
    expect(board.tool).toBe('select');
  });

  it('navigates into group on double click and exits on Escape (BOARD-909)', () => {
    const board = createBoard({ plugins: [containersPlugin] });
    const c1 = board.create({ type: 'frame', x: 10, y: 10, w: 50, h: 50, props: { name: 'C1' } })!;
    const c2 = board.create({ type: 'frame', x: 70, y: 10, w: 50, h: 50, props: { name: 'C2' } })!;
    const group = board.create({ type: 'group', x: 10, y: 10, w: 110, h: 50, props: {} })!;
    board.update(c1.id, { parentId: group.id });
    board.update(c2.id, { parentId: group.id });

    board.setTool('select');

    // Single click selects the outer group
    board.dispatch({
      type: 'pointer-down',
      pointerId: 1,
      pointerType: 'mouse',
      point: { x: 20, y: 20 },
      screen: { x: 20, y: 20 },
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 1,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    board.dispatch({
      type: 'pointer-up',
      pointerId: 1,
      pointerType: 'mouse',
      point: { x: 20, y: 20 },
      screen: { x: 20, y: 20 },
      pressure: 0,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 0,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    expect(board.selection).toEqual([group.id]);

    // Double click enters the group and selects the child under point
    board.dispatch({
      type: 'pointer-down',
      pointerId: 1,
      pointerType: 'mouse',
      point: { x: 20, y: 20 },
      screen: { x: 20, y: 20 },
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 1,
      clickCount: 2,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    board.dispatch({
      type: 'pointer-up',
      pointerId: 1,
      pointerType: 'mouse',
      point: { x: 20, y: 20 },
      screen: { x: 20, y: 20 },
      pressure: 0,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 0,
      clickCount: 2,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    expect(board.selection).toEqual([c1.id]);

    // Escape exits the group and selects the parent group
    board.dispatch({
      type: 'key-down',
      key: 'Escape',
      code: 'Escape',
      repeat: false,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    expect(board.selection).toEqual([group.id]);
  });

  it('moves group descendants together and reparents to frame on drop', () => {
    const board = createBoard({ plugins: [containersPlugin] });
    const frame = board.create({ type: 'frame', x: 200, y: 0, w: 400, h: 400, props: { name: 'Target' } })!;
    const c1 = board.create({ type: 'frame', x: 10, y: 10, w: 40, h: 40, props: { name: 'C1' } })!;
    const group = board.create({ type: 'group', x: 10, y: 10, w: 40, h: 40, props: {} })!;
    board.update(c1.id, { parentId: group.id });

    board.setTool('select');
    board.select([group.id]);

    // Drag group by dx = 250, dy = 50
    board.dispatch({
      type: 'pointer-down',
      pointerId: 1,
      pointerType: 'mouse',
      point: { x: 20, y: 20 },
      screen: { x: 20, y: 20 },
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 1,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    board.dispatch({
      type: 'pointer-move',
      pointerId: 1,
      pointerType: 'mouse',
      point: { x: 270, y: 70 },
      screen: { x: 270, y: 70 },
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 1,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });
    board.dispatch({
      type: 'pointer-up',
      pointerId: 1,
      pointerType: 'mouse',
      point: { x: 270, y: 70 },
      screen: { x: 270, y: 70 },
      pressure: 0,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 0,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    });

    const updatedChild = board.getElement(c1.id)!;
    expect(updatedChild.x).toBe(260); // 10 + 250
    expect(updatedChild.y).toBe(60); // 10 + 50

    const updatedGroup = board.getElement(group.id)!;
    // Group should be reparented to target frame (center at 280, 80 inside frame 200..600, 0..400)
    expect(updatedGroup.parentId).toBe(frame.id);
  });
});

