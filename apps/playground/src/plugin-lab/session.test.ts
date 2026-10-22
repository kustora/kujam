import { afterEach, describe, expect, it, vi } from 'vitest';
import * as core from '@kujam/core';
import * as shapes from '@kujam/shapes';
import { LAB_EXAMPLES, findExample } from './examples.js';
import type { LabIssue } from './runtime.js';
import { createPluginLabSession, type PluginLabSession } from './session.js';

const modules = { '@kujam/core': core, '@kujam/shapes': shapes };
const basePlugins = [core.defaultCommands, shapes.defaultElements, shapes.defaultTools];

let session: PluginLabSession | null = null;
afterEach(() => {
  session?.dispose();
  session = null;
});

function start(extra: Partial<Parameters<typeof createPluginLabSession>[0]> = {}) {
  const issues: LabIssue[] = [];
  const mounted: core.Board[] = [];
  const unmounted: core.Board[] = [];
  session = createPluginLabSession({
    basePlugins,
    modules,
    boardOptions: { locale: 'id' },
    seed: (board) => {
      board.create({ id: 'note', type: 'sticky', x: 0, y: 0, w: 100, h: 100 });
    },
    mount: (board) => {
      mounted.push(board);
      return () => unmounted.push(board);
    },
    onIssue: (issue) => issues.push(issue),
    ...extra,
  });
  return { session, issues, mounted, unmounted };
}

const pluginSource = (id: string, type: string) => `
  import { defineElement, definePlugin, schema, string } from '@kujam/core';
  export default definePlugin({
    id: '${id}',
    elements: [defineElement({ type: '${type}', version: 1, props: schema({ label: string() }), defaults: { label: '' } })],
  });`;

describe('createPluginLabSession', () => {
  it('starts with the base plugins, seeded and mounted', () => {
    const { session, mounted } = start();
    expect(session.userPlugins).toEqual([]);
    expect(session.board.getElement('note')).toBeDefined();
    expect(mounted).toEqual([session.board]);
  });

  it('re-installs on apply: new board, same document, view swapped, old board disposed', () => {
    const { session, mounted, unmounted } = start();
    const first = session.board;
    first.setCamera({ x: 40, y: 20, zoom: 2 });
    first.select(['note']);
    first.setTool('sticky');

    const result = session.apply(pluginSource('lab.v1', 'lab.item'));
    expect(result).toEqual({ ok: true, issues: [] });
    const second = session.board;
    expect(second).not.toBe(first);
    expect(first.disposed).toBe(true);
    expect(unmounted).toEqual([first]);
    expect(mounted).toEqual([first, second]);
    expect(second.elements.has('lab.item')).toBe(true);
    expect(second.getElement('note')).toBeDefined();
    expect(second.getCamera()).toMatchObject({ x: 40, y: 20, zoom: 2 });
    expect(second.selection).toEqual(['note']);
    expect(second.tool).toBe('sticky');
    expect(session.userPlugins.map((p) => p.id)).toEqual(['lab.v1']);
  });

  it('replaces the previous version: elements of a removed type stay as unknown types', () => {
    const { session } = start();
    session.apply(pluginSource('lab.v1', 'lab.item'));
    session.board.create({ id: 'item', type: 'lab.item', x: 0, y: 0, w: 50, h: 50 });

    expect(session.apply(pluginSource('lab.v2', 'lab.other')).ok).toBe(true);
    expect(session.board.plugins.has('lab.v1')).toBe(false);
    expect(session.board.elements.has('lab.item')).toBe(false);
    expect(session.board.elements.has('lab.other')).toBe(true);
    expect(session.board.getElement('item')?.type).toBe('lab.item');

    // Bringing the type back renders the element again.
    session.apply(pluginSource('lab.v1', 'lab.item'));
    expect(session.board.elements.has('lab.item')).toBe(true);
    expect(session.board.getElement('item')).toBeDefined();
  });

  it('runs the old setup teardown when re-installing', () => {
    const { session } = start();
    const log: string[] = [];
    (globalThis as Record<string, unknown>).__labLog = log;
    const source = (n: number) => `
      import { definePlugin } from '@kujam/core';
      export default definePlugin({
        id: 'lab.setup',
        setup() {
          globalThis.__labLog.push('setup ${n}');
          return () => globalThis.__labLog.push('teardown ${n}');
        },
      });`;
    session.apply(source(1));
    session.apply(source(2));
    expect(log).toEqual(['setup 1', 'setup 2', 'teardown 1']);
    session.dispose();
    expect(log.at(-1)).toBe('teardown 2');
    delete (globalThis as Record<string, unknown>).__labLog;
  });

  it.each([
    ['compile', 'export const = 1;'],
    ['evaluate', "throw new Error('top level');"],
    ['evaluate', 'export const nothing = 1;'],
    ['install', "import { definePlugin } from '@kujam/core'; export default { id: 'Bad Id' };"],
    [
      'install',
      "import { definePlugin } from '@kujam/core'; export default definePlugin({ id: 'lab.s', setup() { throw new Error('setup boom'); } });",
    ],
    [
      'install',
      // Duplicates a built-in element type.
      "import { defineElement, schema } from '@kujam/core'; export const s = defineElement({ type: 'sticky', version: 1, props: schema({}) });",
    ],
  ])('keeps the previous board running on a %s error', (kind, source) => {
    const { session, issues, mounted } = start();
    session.apply(pluginSource('lab.v1', 'lab.item'));
    const before = session.board;

    const result = session.apply(source);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.kind).toBe(kind);
    expect(issues).toContainEqual(result.issues[0]);
    expect(session.board).toBe(before);
    expect(before.disposed).toBe(false);
    expect(session.board.elements.has('lab.item')).toBe(true);
    expect(mounted.at(-1)).toBe(before);
  });

  it('remounts the previous board when mounting the new one throws', () => {
    let fail = false;
    const mounted: core.Board[] = [];
    const { session, issues } = start({
      mount: (board) => {
        if (fail) {
          fail = false;
          throw new Error('mount failed');
        }
        mounted.push(board);
        return () => {};
      },
    });
    const before = session.board;
    fail = true;
    const result = session.apply(pluginSource('lab.v1', 'lab.item'));
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ kind: 'install', origin: 'mount' });
    expect(issues).toHaveLength(1);
    expect(session.board).toBe(before);
    expect(mounted.at(-1)).toBe(before);
  });

  it('reports tool errors at runtime while the board keeps working', () => {
    const { session, issues } = start();
    session.apply(findExample('broken')!.source);
    const board = session.board;
    board.setTool('lab.faulty');
    const pointer = {
      type: 'pointer-down',
      point: { x: 0, y: 0 },
      screen: { x: 0, y: 0 },
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    } as unknown as core.BoardInputEvent;
    expect(() => board.dispatch(pointer)).toThrow('Tool sengaja gagal');
    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: 'runtime',
        message: 'Tool sengaja gagal',
        origin: 'tool lab.faulty · idle.onPointerDown',
      }),
    );
    expect(board.disposed).toBe(false);
    expect(board.create({ type: 'sticky', x: 0, y: 0, w: 10, h: 10 })).toBeDefined();
  });

  it('forwards board error events as issues', () => {
    const { session, issues } = start();
    session.apply(pluginSource('lab.v1', 'lab.item'));
    session.board.update('note', { props: { color: 'not-a-color' } });
    expect(issues).toContainEqual(
      expect.objectContaining({ kind: 'runtime', origin: 'invalid-props' }),
    );
  });

  it('reset removes the user plugins but keeps the document', () => {
    const { session } = start();
    session.apply(pluginSource('lab.v1', 'lab.item'));
    expect(session.reset().ok).toBe(true);
    expect(session.userPlugins).toEqual([]);
    expect(session.board.plugins.has('lab.v1')).toBe(false);
    expect(session.board.getElement('note')).toBeDefined();
  });

  it('dispose is idempotent and stops further applies', () => {
    const { session, unmounted } = start();
    const board = session.board;
    session.dispose();
    session.dispose();
    expect(board.disposed).toBe(true);
    expect(unmounted).toEqual([board]);
    expect(session.apply(pluginSource('lab.v1', 'lab.item')).ok).toBe(false);
  });

  it('isolates a throwing onIssue listener', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { session } = start({
      onIssue: () => {
        throw new Error('listener');
      },
    });
    expect(session.apply('export const = 1;').ok).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('LAB_EXAMPLES', () => {
  it.each(LAB_EXAMPLES.map((e) => [e.id, e] as const))(
    '%s compiles and installs',
    (_id, example) => {
      const { session, issues } = start();
      expect(session.apply(example.source)).toEqual({ ok: true, issues: [] });
      expect(issues).toEqual([]);
      expect(session.userPlugins.length).toBeGreaterThan(0);
    },
  );

  it('the brush example registers a brush the pen can use', () => {
    const { session } = start();
    session.apply(findExample('brush')!.source);
    expect(session.board.brushes.get('lab.crayon')).toMatchObject({ blend: 'multiply' });
  });

  it('the stamp tool stamps a star per click', () => {
    const { session } = start();
    session.apply(findExample('stamp')!.source);
    const board = session.board;
    board.setTool('lab.stamp');
    const base = {
      screen: { x: 0, y: 0 },
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    };
    for (const x of [100, 300]) {
      board.dispatch({ ...base, type: 'pointer-down', point: { x, y: 100 } } as never);
      board.dispatch({ ...base, type: 'pointer-up', buttons: 0, point: { x, y: 100 } } as never);
    }
    const stars = Object.values(board.getDocument().records).filter(
      (r) =>
        r.kind === 'element' && r.type === 'geo' && (r.props as { geo: string }).geo === 'star',
    ) as core.ElementRecord[];
    expect(stars.map((el) => el.x).sort((a, b) => a - b)).toEqual([68, 268]);
  });

  it('the card example resolves its data asynchronously', async () => {
    const { session } = start();
    session.apply(findExample('card')!.source);
    const board = session.board;
    const el = board.create({ type: 'lab.weather-card', x: 0, y: 0, w: 240, h: 96 })!;
    expect(board.getElementData(el.id).status).toBe('loading');
    await vi.waitFor(() => expect(board.getElementData(el.id).status).toBe('ready'), {
      timeout: 2000,
    });
    expect(board.getElementData(el.id, { load: false })).toMatchObject({
      data: { city: 'Bandung' },
    });
  });
});
