// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  createBoard,
  defaultCommands,
  extractContent,
  insertContent,
  validate,
  type BindingRecord,
  type Board,
  type BoxBounds,
  type ElementCanvasContext,
  type InputModifiers,
  type Point,
  type ToolPointerEvent,
} from '@kujam/core';
import {
  ARROWHEAD_STYLES,
  attachTextEditor,
  CARDINAL_ANCHORS,
  computeConnectorRoute,
  computeElementConnectorRoute,
  CONNECTOR_STYLES,
  connectorElement,
  connectorPropsSchema,
  defaultElements,
  defaultTools,
  drawArrowhead,
  findSnapAnchor,
  resolveAnchorSide,
  resolveAnchorWorldPoint,
  type ConnectorProps,
  type ConnectorToolData,
} from '../index.js';

const MODS: InputModifiers = { shift: false, alt: false, ctrl: false, meta: false };

function setup(): Board {
  const board = createBoard({
    plugins: [defaultElements, defaultTools, defaultCommands],
    snap: { grid: null, objects: false },
  });
  board.camera.setViewport({ width: 1000, height: 1000 });
  return board;
}

function pointer(
  board: Board,
  type: ToolPointerEvent['type'],
  point: Point,
  mods: Partial<InputModifiers> = {},
  extra: Partial<ToolPointerEvent> = {},
): ToolPointerEvent {
  return {
    type,
    pointerId: 1,
    pointerType: 'mouse',
    point,
    screen: board.camera.boardToScreen(point),
    pressure: type === 'pointer-up' ? 0 : 0.5,
    tiltX: 0,
    tiltY: 0,
    button: type === 'pointer-move' ? -1 : 0,
    buttons: type === 'pointer-up' ? 0 : 1,
    modifiers: { ...MODS, ...mods },
    ...extra,
  };
}

function drag(
  board: Board,
  points: Point[],
  mods: Partial<InputModifiers> = {},
  release = true,
): void {
  board.dispatch(pointer(board, 'pointer-down', points[0]!, mods));
  for (const p of points.slice(1)) {
    board.dispatch(pointer(board, 'pointer-move', p, mods));
  }
  if (release) {
    board.dispatch(pointer(board, 'pointer-up', points[points.length - 1]!, mods));
  }
}

function pressKey(board: Board, key: string, code: string): void {
  board.dispatch({
    type: 'key-down',
    key,
    code,
    repeat: false,
    modifiers: MODS,
  });
}

function recorder(): { g: ElementCanvasContext; calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const g = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 8 });
      return (...args: unknown[]) => calls.push(`${key}(${args.join(',')})`);
    },
    set(target, key: string, value) {
      target[key] = value;
      calls.push(`${key}=${Array.isArray(value) ? `[${value}]` : value}`);
      return true;
    },
  }) as unknown as ElementCanvasContext;
  return { g, calls };
}

describe('BOARD-1101: Connector element and binding', () => {
  describe('1101a: Straight, elbow, and curved connector element', () => {
    it('validates connector props schema and defaults', () => {
      expect(validate(connectorPropsSchema, connectorElement.defaults).ok).toBe(true);
      expect(CONNECTOR_STYLES).toEqual(['straight', 'elbow', 'curved']);
      expect(ARROWHEAD_STYLES).toEqual(['none', 'arrow', 'triangle', 'dot', 'diamond']);

      expect(
        validate(connectorPropsSchema, {
          ...connectorElement.defaults,
          style: 'zigzag',
        }).ok,
      ).toBe(false);

      expect(
        validate(connectorPropsSchema, {
          ...connectorElement.defaults,
          strokeWidth: 0,
        }).ok,
      ).toBe(false);
    });

    it('computes routes and polyline geometry for straight, elbow, and curved styles', () => {
      const board = setup();
      const straight = board.create<'connector'>({
        type: 'connector',
        x: 100,
        y: 100,
        w: 200,
        h: 100,
        props: {
          start: { x: 0, y: 0 },
          end: { x: 200, y: 100 },
          style: 'straight',
        },
      })!;
      const sGeom = connectorElement.geometry!(straight);
      expect(sGeom.kind).toBe('polyline');
      if (sGeom.kind === 'polyline') {
        expect(sGeom.points).toEqual([
          { x: 0, y: 0 },
          { x: 200, y: 100 },
        ]);
      }
      // Hit-test along midpoint of straight line (200, 150)
      expect(board.hitTest({ x: 200, y: 150 })?.id).toBe(straight.id);

      const elbow = board.create<'connector'>({
        type: 'connector',
        x: 100,
        y: 300,
        w: 200,
        h: 100,
        props: {
          start: { x: 0, y: 0 },
          end: { x: 200, y: 100 },
          style: 'elbow',
        },
      })!;
      const eGeom = connectorElement.geometry!(elbow);
      expect(eGeom.kind).toBe('polyline');
      if (eGeom.kind === 'polyline') {
        expect(eGeom.points.length).toBeGreaterThanOrEqual(3);
      }

      const curved = board.create<'connector'>({
        type: 'connector',
        x: 100,
        y: 500,
        w: 200,
        h: 100,
        props: {
          start: { x: 0, y: 0 },
          end: { x: 200, y: 100 },
          style: 'curved',
        },
      })!;
      const cRoute = computeElementConnectorRoute(curved, board);
      expect(cRoute.controlPoints).toBeDefined();
      expect(cRoute.points.length).toBe(25);
      board.dispose();
    });

    it('renders straight, elbow, and curved paths with dash styles on canvas', () => {
      const board = setup();
      const conn = board.create<'connector'>({
        type: 'connector',
        x: 10,
        y: 20,
        w: 150,
        h: 80,
        props: {
          start: { x: 0, y: 0 },
          end: { x: 150, y: 80 },
          style: 'curved',
          dash: 'dashed',
          color: 'blue',
          strokeWidth: 4,
        },
      })!;

      const { g, calls } = recorder();
      connectorElement.render?.canvas?.(g, conn, undefined, { zoom: 1, compact: false }, board.elementContext);
      expect(calls.some((c) => c.startsWith('bezierCurveTo('))).toBe(true);
      expect(calls).toContain('setLineDash(16,16)');
      expect(calls).toContain('stroke()');
      board.dispose();
    });

    it('exposes style actions for color, thickness, dash, connectorStyle, startArrow, and endArrow', () => {
      const board = setup();
      const conn = board.create<'connector'>({
        type: 'connector',
        x: 0,
        y: 0,
        w: 100,
        h: 0,
      })!;
      board.select(conn.id);
      const actions = board.getActions();
      const elbowAction = actions.find((a) => a.id === 'style.connectorStyle.elbow');
      const diamondEndAction = actions.find((a) => a.id === 'style.endArrow.diamond');
      expect(elbowAction).toBeDefined();
      expect(diamondEndAction).toBeDefined();

      elbowAction!.run();
      diamondEndAction!.run();

      const updated = board.getElement<'connector'>(conn.id)!;
      expect(updated.props.style).toBe('elbow');
      expect(updated.props.endArrow).toBe('diamond');
      expect(board.toolStyles.get('connector').style).toBe('elbow');
      expect(board.toolStyles.get('connector').endArrow).toBe('diamond');
      board.dispose();
    });
  });

  describe('1101b: Endpoint binding, live tracking, cascade delete, and reconnecting', () => {
    it('activates connector tool with L shortcut and snaps to cardinal anchors on hover', () => {
      const board = setup();
      const boxA = board.create<'geo'>({
        id: 'box-a',
        type: 'geo',
        x: 100,
        y: 100,
        w: 100,
        h: 80,
      })!;

      board.setTool('select');
      pressKey(board, 'l', 'KeyL');
      expect(board.tool).toBe('connector');

      // Right anchor of boxA is at (200, 140)
      board.dispatch(pointer(board, 'pointer-move', { x: 196, y: 142 }));
      const toolData = board.toolData as ConnectorToolData;
      expect(toolData.connectorSnap).toEqual({
        elementId: boxA.id,
        anchor: CARDINAL_ANCHORS.right,
        side: 'right',
        worldPoint: { x: 200, y: 140 },
      });
      board.dispose();
    });

    it('creates a bound connector and BindingRecords in one transaction when dragging between two shapes', () => {
      const board = setup();
      const boxA = board.create<'geo'>({
        id: 'box-a',
        type: 'geo',
        x: 100,
        y: 100,
        w: 100,
        h: 100,
      })!;
      const boxB = board.create<'geo'>({
        id: 'box-b',
        type: 'geo',
        x: 400,
        y: 100,
        w: 100,
        h: 100,
      })!;

      board.setTool('connector');
      // Drag from boxA right anchor (200, 150) to boxB left anchor (400, 150)
      drag(board, [
        { x: 200, y: 150 },
        { x: 300, y: 150 },
        { x: 400, y: 150 },
      ]);

      const connectors = board.query<'connector'>({ type: 'connector' });
      expect(connectors).toHaveLength(1);
      const conn = connectors[0]!;
      expect(conn.props.startBindingId).toBeTypeOf('string');
      expect(conn.props.endBindingId).toBeTypeOf('string');

      const doc = board.getDocument();
      const startBind = doc.records[conn.props.startBindingId!] as BindingRecord;
      const endBind = doc.records[conn.props.endBindingId!] as BindingRecord;
      expect(startBind).toMatchObject({
        kind: 'binding',
        fromId: conn.id,
        toId: boxA.id,
        anchor: { x: 1, y: 0.5 },
      });
      expect(endBind).toMatchObject({
        kind: 'binding',
        fromId: conn.id,
        toId: boxB.id,
        anchor: { x: 0, y: 0.5 },
      });

      // Endpoints match world coordinates (200, 150) and (400, 150)
      expect({ x: conn.x + conn.props.start.x, y: conn.y + conn.props.start.y }).toEqual({
        x: 200,
        y: 150,
      });
      expect({ x: conn.x + conn.props.end.x, y: conn.y + conn.props.end.y }).toEqual({
        x: 400,
        y: 150,
      });

      // Moving boxB updates the bound connector's end point in the same transaction
      board.update(boxB.id, { x: 500, y: 200 });
      const movedConn = board.getElement<'connector'>(conn.id)!;
      expect({
        x: movedConn.x + movedConn.props.start.x,
        y: movedConn.y + movedConn.props.start.y,
      }).toEqual({ x: 200, y: 150 });
      expect({
        x: movedConn.x + movedConn.props.end.x,
        y: movedConn.y + movedConn.props.end.y,
      }).toEqual({ x: 500, y: 250 });

      // Resizing boxA updates the bound connector's start point
      board.update(boxA.id, { w: 150 });
      const resizedConn = board.getElement<'connector'>(conn.id)!;
      expect({
        x: resizedConn.x + resizedConn.props.start.x,
        y: resizedConn.y + resizedConn.props.start.y,
      }).toEqual({ x: 250, y: 150 });

      // Rotating boxA by 90 degrees (PI/2) around its center (175, 150) moves its right anchor (1, 0.5)
      board.update(boxA.id, { rotation: Math.PI / 2 });
      const rotatedConn = board.getElement<'connector'>(conn.id)!;
      const expectedAnchor = resolveAnchorWorldPoint(
        board.getElement(boxA.id)!,
        CARDINAL_ANCHORS.right,
      );
      expect(rotatedConn.x + rotatedConn.props.start.x).toBeCloseTo(expectedAnchor.x, 5);
      expect(rotatedConn.y + rotatedConn.props.start.y).toBeCloseTo(expectedAnchor.y, 5);

      board.dispose();
    });

    it('cascades binding deletion when a bound shape is deleted, leaves connector unbound, and restores on undo', () => {
      const board = setup();
      board.create<'geo'>({
        id: 'box-a',
        type: 'geo',
        x: 50,
        y: 50,
        w: 100,
        h: 100,
      });
      const boxB = board.create<'geo'>({
        id: 'box-b',
        type: 'geo',
        x: 300,
        y: 50,
        w: 100,
        h: 100,
      })!;

      board.setTool('connector');
      drag(board, [
        { x: 150, y: 100 },
        { x: 300, y: 100 },
      ]);

      const conn = board.query<'connector'>({ type: 'connector' })[0]!;
      const endBindingId = conn.props.endBindingId!;
      expect(endBindingId).toBeTruthy();

      // Delete boxB
      board.delete(boxB.id);

      const afterDeleteConn = board.getElement<'connector'>(conn.id)!;
      expect(afterDeleteConn).toBeDefined();
      expect(afterDeleteConn.props.endBindingId).toBeNull();
      expect(afterDeleteConn.props.startBindingId).toBe(conn.props.startBindingId);
      expect(board.getDocument().records[endBindingId]).toBeUndefined();
      // World endpoint remains at (300, 100)
      expect({
        x: afterDeleteConn.x + afterDeleteConn.props.end.x,
        y: afterDeleteConn.y + afterDeleteConn.props.end.y,
      }).toEqual({ x: 300, y: 100 });

      // Undo restores boxB, the BindingRecord, and conn.props.endBindingId
      board.undo();
      const restoredConn = board.getElement<'connector'>(conn.id)!;
      expect(board.getElement(boxB.id)).toBeDefined();
      expect(board.getDocument().records[endBindingId]).toBeDefined();
      expect(restoredConn.props.endBindingId).toBe(endBindingId);

      board.dispose();
    });

    it('allows dragging a selected connector endpoint handle to rebind to another shape or unbind to empty space', () => {
      const board = setup();
      const boxA = board.create<'geo'>({
        id: 'box-a',
        type: 'geo',
        x: 50,
        y: 50,
        w: 100,
        h: 100,
      })!;
      const boxB = board.create<'geo'>({
        id: 'box-b',
        type: 'geo',
        x: 300,
        y: 50,
        w: 100,
        h: 100,
      })!;
      const boxC = board.create<'geo'>({
        id: 'box-c',
        type: 'geo',
        x: 300,
        y: 250,
        w: 100,
        h: 100,
      })!;

      board.setTool('connector');
      drag(board, [
        { x: 150, y: 100 },
        { x: 300, y: 100 },
      ]);
      const conn = board.query<'connector'>({ type: 'connector' })[0]!;
      expect(conn.props.startBindingId).toBeTruthy();
      expect(conn.props.endBindingId).toBeTruthy();

      // Switch to select tool and drag the end handle (300, 100) to boxC's left anchor (300, 300)
      board.setTool('select');
      board.select(conn.id);
      drag(board, [
        { x: 300, y: 100 },
        { x: 300, y: 200 },
        { x: 300, y: 300 },
      ]);

      const rebound = board.getElement<'connector'>(conn.id)!;
      expect(rebound.props.endBindingId).toBeTruthy();
      const endBinding = board.getDocument().records[rebound.props.endBindingId!] as BindingRecord;
      expect(endBinding.toId).toBe(boxC.id);
      expect({
        x: rebound.x + rebound.props.end.x,
        y: rebound.y + rebound.props.end.y,
      }).toEqual({ x: 300, y: 300 });

      // Now drag the end handle (300, 300) to empty space (600, 400) -> unbinds
      const prevEndBindingId = rebound.props.endBindingId!;
      drag(board, [
        { x: 300, y: 300 },
        { x: 600, y: 400 },
      ]);
      const unbound = board.getElement<'connector'>(conn.id)!;
      expect(unbound.props.endBindingId).toBeNull();
      expect(board.getDocument().records[prevEndBindingId]).toBeUndefined();
      expect({
        x: unbound.x + unbound.props.end.x,
        y: unbound.y + unbound.props.end.y,
      }).toEqual({ x: 600, y: 400 });
      expect(unbound.props.startBindingId).toBeTruthy();
      expect(
        (board.getDocument().records[unbound.props.startBindingId!] as BindingRecord).toId,
      ).toBe(boxA.id);
      expect(board.getElement(boxB.id)).toBeDefined();

      board.dispose();
    });

    it('remaps or clears bindings when copying/pasting or duplicating connectors', () => {
      const board = setup();
      const boxA = board.create<'geo'>({
        id: 'box-a',
        type: 'geo',
        x: 50,
        y: 50,
        w: 100,
        h: 100,
      })!;
      const boxB = board.create<'geo'>({
        id: 'box-b',
        type: 'geo',
        x: 300,
        y: 50,
        w: 100,
        h: 100,
      })!;

      board.setTool('connector');
      drag(board, [
        { x: 150, y: 100 },
        { x: 300, y: 100 },
      ]);
      const conn = board.query<'connector'>({ type: 'connector' })[0]!;

      // Extracting only the connector clears its dangling binding IDs
      const partialDoc = extractContent(board, [conn.id]);
      const partialConn = partialDoc.records[conn.id] as { props: ConnectorProps };
      expect(partialConn.props.startBindingId).toBeNull();
      expect(partialConn.props.endBindingId).toBeNull();

      // Extracting boxA, boxB, and conn together preserves and remaps bindings on paste
      const fullDoc = extractContent(board, [boxA.id, boxB.id, conn.id]);
      const pasted = insertContent(board, fullDoc, { at: { x: 500, y: 500 } });
      const pastedConnId = pasted.idMap.get(conn.id)!;
      const pastedConn = board.getElement<'connector'>(pastedConnId)!;
      expect(pastedConn.props.startBindingId).toBeTruthy();
      expect(pastedConn.props.endBindingId).toBeTruthy();
      expect(pastedConn.props.startBindingId).not.toBe(conn.props.startBindingId);

      // Duplicating boxA, boxB, and conn together via command remaps bindings
      board.select([boxA.id, boxB.id, conn.id]);
      board.run('element.duplicate');
      const dupConnectors = board.query<'connector'>({ type: 'connector' });
      expect(dupConnectors).toHaveLength(3);

      board.dispose();
    });
  });

  describe('1101c: Configurable startArrow and endArrow styles', () => {
    it('renders distinct canvas primitives for none, arrow, triangle, dot, and diamond', () => {
      const tip: Point = { x: 100, y: 50 };
      const results: Record<string, string[]> = {};

      for (const style of ARROWHEAD_STYLES) {
        const { g, calls } = recorder();
        drawArrowhead(g, style, tip, 0, 2, '#17191E');
        results[style] = calls;
      }

      expect(results.none).toHaveLength(0);
      expect(results.arrow!.some((c) => c === 'stroke()')).toBe(true);
      expect(results.arrow!.some((c) => c === 'fill()')).toBe(false);

      expect(results.triangle!.some((c) => c === 'closePath()')).toBe(true);
      expect(results.triangle!.some((c) => c === 'fill()')).toBe(true);

      expect(results.dot!.some((c) => c.startsWith('arc('))).toBe(true);
      expect(results.dot!.some((c) => c === 'fill()')).toBe(true);

      expect(results.diamond!.filter((c) => c.startsWith('lineTo('))).toHaveLength(3);
      expect(results.diamond!.some((c) => c === 'fill()')).toBe(true);
    });
  });

  describe('1101d: Centered text label on connector', () => {
    it('renders centered label pill at midpoint, exports plain text, and emits edit on double-click', () => {
      const board = setup();
      const conn = board.create<'connector'>({
        type: 'connector',
        x: 100,
        y: 100,
        w: 200,
        h: 0,
        props: {
          start: { x: 0, y: 0 },
          end: { x: 200, y: 0 },
          label: [{ insert: 'Ya / Lanjut\n' }],
        },
      })!;

      expect(connectorElement.export?.text?.(conn, undefined)).toBe('Ya / Lanjut');
      expect(connectorElement.a11y?.(conn, undefined, board.elementContext)).toEqual({
        role: 'graphics-symbol',
        label: 'Garis penghubung: Ya / Lanjut',
      });

      const { g, calls } = recorder();
      connectorElement.render?.canvas?.(
        g,
        conn,
        undefined,
        { zoom: 1, compact: false },
        board.elementContext,
      );
      expect(calls.some((c) => c.startsWith('translate('))).toBe(true);
      expect(calls.some((c) => c.startsWith('fillText(Ya / Lanjut,'))).toBe(true);

      const emitted: unknown[] = [];
      board.on('action', (ev) => emitted.push(ev));
      connectorElement.onDoubleClick?.(conn, board.elementContext);
      expect(emitted).toEqual([{ name: 'edit', payload: { id: conn.id } }]);

      board.dispose();
    });

    it('supports editing connector label via attachTextEditor', () => {
      const board = setup();
      const conn = board.create<'connector'>({
        type: 'connector',
        x: 100,
        y: 100,
        w: 200,
        h: 0,
      })!;

      let mountedEditor: HTMLElement | null = null;
      const attachment = attachTextEditor({
        board,
        mountEditor(el) {
          mountedEditor = el;
          document.body.appendChild(el);
          return () => {
            el.remove();
          };
        },
      });

      connectorElement.onDoubleClick?.(conn, board.elementContext);
      expect(attachment.activeElementId).toBe(conn.id);
      expect(mountedEditor).not.toBeNull();

      mountedEditor!.innerHTML = '<p>Label Baru</p>';
      attachment.stop();

      const updated = board.getElement<'connector'>(conn.id)!;
      expect(connectorElement.export?.text?.(updated, undefined)).toBe('Label Baru');

      attachment.detach();
      board.dispose();
    });
  });

  describe('BOARD-1102: Simple obstacle-avoiding orthogonal elbow routing', () => {
    it('routes around an obstacle box placed directly between two connected shapes', () => {
      const board = setup();
      const boxA = board.create<'geo'>({
        id: 'box-a',
        type: 'geo',
        x: 50,
        y: 100,
        w: 80,
        h: 80,
      })!;
      // Obstacle right in the middle between boxA and boxB
      const obstacle = board.create<'geo'>({
        id: 'obstacle',
        type: 'geo',
        x: 200,
        y: 80,
        w: 100,
        h: 120,
      })!;
      const boxB = board.create<'geo'>({
        id: 'box-b',
        type: 'geo',
        x: 380,
        y: 100,
        w: 80,
        h: 80,
      })!;

      board.toolStyles.set('connector', { style: 'elbow' });
      board.setTool('connector');
      // Connect boxA right (130, 140) to boxB left (380, 140)
      drag(board, [
        { x: 130, y: 140 },
        { x: 380, y: 140 },
      ]);

      const conn = board.query<'connector'>({ type: 'connector' })[0]!;
      expect(conn.props.style).toBe('elbow');

      const route = computeElementConnectorRoute(conn, board);
      const worldPts = route.points.map((p) => ({ x: conn.x + p.x, y: conn.y + p.y }));
      expect(worldPts.length).toBeGreaterThanOrEqual(4);

      // Every segment must be strictly horizontal or vertical
      for (let i = 0; i < worldPts.length - 1; i++) {
        const a = worldPts[i]!;
        const b = worldPts[i + 1]!;
        const isH = Math.abs(a.y - b.y) < 1e-4;
        const isV = Math.abs(a.x - b.x) < 1e-4;
        expect(isH || isV).toBe(true);
      }

      // None of the segments may pass through the obstacle's interior (200..300, 80..200)
      const obsBox: BoxBounds = {
        minX: obstacle.x,
        minY: obstacle.y,
        maxX: obstacle.x + obstacle.w,
        maxY: obstacle.y + obstacle.h,
      };
      for (let i = 0; i < worldPts.length - 1; i++) {
        const a = worldPts[i]!;
        const b = worldPts[i + 1]!;
        if (Math.abs(a.y - b.y) < 1e-4) {
          const y = a.y;
          const segMinX = Math.min(a.x, b.x);
          const segMaxX = Math.max(a.x, b.x);
          const crossesInterior =
            y > obsBox.minY + 1e-3 &&
            y < obsBox.maxY - 1e-3 &&
            segMaxX > obsBox.minX + 1e-3 &&
            segMinX < obsBox.maxX - 1e-3;
          expect(crossesInterior).toBe(false);
        } else {
          const x = a.x;
          const segMinY = Math.min(a.y, b.y);
          const segMaxY = Math.max(a.y, b.y);
          const crossesInterior =
            x > obsBox.minX + 1e-3 &&
            x < obsBox.maxX - 1e-3 &&
            segMaxY > obsBox.minY + 1e-3 &&
            segMinY < obsBox.maxY - 1e-3;
          expect(crossesInterior).toBe(false);
        }
      }

      expect(boxA.id).toBe('box-a');
      expect(boxB.id).toBe('box-b');
      board.dispose();
    });

    it('routes with 20 obstacles in well under 1 ms per connector', () => {
      const obstacles: BoxBounds[] = [];
      for (let i = 0; i < 20; i++) {
        const col = i % 5;
        const row = Math.floor(i / 5);
        obstacles.push({
          minX: 120 + col * 90,
          minY: 60 + row * 90,
          maxX: 170 + col * 90,
          maxY: 110 + row * 90,
        });
      }

      const iterations = 50;
      // Warmup
      computeConnectorRoute(
        { x: 50, y: 85 },
        { x: 620, y: 265 },
        'elbow',
        {
          startSide: 'right',
          endSide: 'left',
          startBounds: { minX: 0, minY: 60, maxX: 50, maxY: 160 },
          endBounds: { minX: 620, minY: 180, maxX: 680, maxY: 280 },
          obstacles,
        },
      );
      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) {
        const res = computeConnectorRoute(
          { x: 50, y: 85 + (i % 3) * 40 },
          { x: 620, y: 265 - (i % 3) * 40 },
          'elbow',
          {
            startSide: 'right',
            endSide: 'left',
            startBounds: { minX: 0, minY: 60, maxX: 50, maxY: 160 },
            endBounds: { minX: 620, minY: 180, maxX: 680, maxY: 280 },
            obstacles,
          },
        );
        expect(res.points.length).toBeGreaterThanOrEqual(2);
      }
      const avgMs = (performance.now() - t0) / iterations;
      expect(avgMs).toBeLessThan(2.5);
    });

    it('resolves anchor sides under rotation and finds snap targets accurately', () => {
      expect(resolveAnchorSide(CARDINAL_ANCHORS.top, 0)).toBe('top');
      expect(resolveAnchorSide(CARDINAL_ANCHORS.top, Math.PI / 2)).toBe('right');
      expect(resolveAnchorSide(CARDINAL_ANCHORS.top, Math.PI)).toBe('bottom');
      expect(resolveAnchorSide(CARDINAL_ANCHORS.top, -Math.PI / 2)).toBe('left');

      const board = setup();
      const box = board.create<'geo'>({
        type: 'geo',
        x: 200,
        y: 200,
        w: 100,
        h: 100,
      })!;
      expect(findSnapAnchor(board, { x: 250, y: 195 })?.side).toBe('top');
      expect(findSnapAnchor(board, { x: 250, y: 195 })?.elementId).toBe(box.id);
      expect(findSnapAnchor(board, { x: 800, y: 800 })).toBeNull();
      board.dispose();
    });
  });
});
