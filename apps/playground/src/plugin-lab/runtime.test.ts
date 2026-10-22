import { describe, expect, it, vi } from 'vitest';
import * as core from '@kujam/core';
import {
  collectPlugins,
  compilePlugins,
  evaluateModule,
  instrumentPlugin,
  LabError,
  LAB_SOURCE_URL,
  locateInSource,
  LOOSE_PLUGIN_ID,
  transpile,
  wasReported,
  type LabIssue,
} from './runtime.js';

const modules = { '@kujam/core': core };

function labError(run: () => unknown): LabIssue {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LabError);
    return (error as LabError).issue;
  }
  throw new Error('expected a LabError');
}

describe('transpile', () => {
  it('strips TypeScript and turns imports into require calls', () => {
    const code = transpile(
      "import { definePlugin, type Board } from '@kujam/core';\nconst id: string = 'x';\nexport default definePlugin({ id });",
    );
    expect(code).toContain("require('@kujam/core')");
    expect(code).not.toContain(': string');
    expect(code).not.toContain('Board');
  });

  it('keeps line numbers', () => {
    const code = transpile("import { a } from 'm';\n\n\nexport const b: number = a;");
    expect(code.split('\n')).toHaveLength(4);
  });

  it('reports syntax errors as compile issues with their position', () => {
    const issue = labError(() => transpile('const a = 1;\nconst b: number = (;'));
    expect(issue.kind).toBe('compile');
    expect(issue.line).toBe(2);
    expect(issue.column).toBe(19);
    expect(issue.message).toMatch(/Unexpected token/);
  });
});

describe('evaluateModule', () => {
  it('resolves imports from the module map and returns the exports', () => {
    const exports = evaluateModule(
      transpile(
        "import { definePlugin } from '@kujam/core';\nexport const n = 2;\nexport default definePlugin({ id: 'demo' });",
      ),
      modules,
    );
    expect(exports.n).toBe(2);
    expect((exports.default as { id: string }).id).toBe('demo');
  });

  it('rejects modules outside the map with the list of available ones', () => {
    const issue = labError(() => evaluateModule(transpile("import 'left-pad';"), modules));
    expect(issue.kind).toBe('evaluate');
    expect(issue.message).toMatch(/"left-pad".*@kujam\/core/);
  });

  it('reports top-level throws as evaluate issues with the source line', () => {
    const issue = labError(() =>
      evaluateModule(transpile("const a = 1;\n\nthrow new Error('boom');"), modules),
    );
    expect(issue.kind).toBe('evaluate');
    expect(issue.message).toBe('boom');
    expect(issue.line).toBe(3);
  });

  it('does not expose the module scope to user code', () => {
    const exports = evaluateModule(
      transpile('export const seen = typeof modules + typeof transpile;'),
      modules,
    );
    expect(exports.seen).toBe('undefinedundefined');
  });
});

describe('locateInSource', () => {
  it('reads Chromium and Firefox stack frames', () => {
    const chromium = Object.assign(new Error('x'), {
      stack: `Error: x\n    at f (${LAB_SOURCE_URL}:12:5)\n    at g (main.ts:1:1)`,
    });
    const firefox = Object.assign(new Error('x'), { stack: `f@${LAB_SOURCE_URL}:7:3\n` });
    expect(locateInSource(chromium)).toEqual({ line: 12, column: 4 });
    expect(locateInSource(firefox)).toEqual({ line: 7, column: 2 });
    expect(locateInSource(new Error('no frame'))).toBeUndefined();
    expect(locateInSource('not an error')).toBeUndefined();
  });
});

describe('collectPlugins', () => {
  const element = core.defineElement({
    type: 'lab.box',
    version: 1,
    props: core.schema({ label: core.string() }),
    defaults: { label: '' },
  });
  const tool = core.defineTool({ id: 'lab.tool', initial: 'idle', states: { idle: {} } });
  const brush = core.defineBrush({ id: 'lab.brush' });

  it('bundles loose definitions into one plugin with toolbar items for tools', () => {
    const [plugin, ...rest] = collectPlugins({ element, tool, brush });
    expect(rest).toEqual([]);
    expect(plugin!.id).toBe(LOOSE_PLUGIN_ID);
    expect(plugin!.elements).toEqual([element]);
    expect(plugin!.tools).toEqual([tool]);
    expect(plugin!.brushes).toEqual([brush]);
    expect(plugin!.toolbarItems).toEqual([
      expect.objectContaining({ toolId: 'lab.tool', label: 'lab.tool' }),
    ]);
  });

  it('keeps exported plugins and does not install their own definitions twice', () => {
    const plugin = core.definePlugin({ id: 'lab.p', elements: [element], brushes: [brush] });
    expect(collectPlugins({ default: plugin, element, brush })).toEqual([plugin]);
  });

  it('puts the default export first and flattens arrays', () => {
    const a = core.definePlugin({ id: 'lab.a' });
    const b = core.definePlugin({ id: 'lab.b' });
    const c = core.definePlugin({ id: 'lab.c' });
    expect(collectPlugins({ list: [b, c], default: a }).map((p) => p.id)).toEqual([
      'lab.a',
      'lab.b',
      'lab.c',
    ]);
  });

  it('fails when nothing usable is exported', () => {
    const issue = labError(() => collectPlugins({ n: 1, s: 'x' }));
    expect(issue.kind).toBe('evaluate');
    expect(issue.message).toMatch(/tidak mengekspor/);
  });
});

describe('instrumentPlugin', () => {
  it('reports element callback errors and falls back to safe values', () => {
    const reporter = vi.fn();
    const plugin = core.definePlugin({
      id: 'lab.p',
      elements: [
        core.defineElement({
          type: 'lab.bad',
          version: 1,
          props: core.schema({}),
          geometry: () => {
            throw new Error('geometry');
          },
          actions: () => {
            throw new Error('actions');
          },
        }),
      ],
    });
    const def = instrumentPlugin(plugin, reporter).elements![0]!;
    const el = { w: 10, h: 20 } as never;
    expect(def.geometry!(el)).toEqual(core.rect(10, 20));
    expect(def.actions!(el, undefined, {} as never)).toEqual([]);
    expect(reporter.mock.calls.map(([issue]) => [issue.kind, issue.message, issue.origin])).toEqual(
      [
        ['runtime', 'geometry', 'elemen lab.bad · geometry'],
        ['runtime', 'actions', 'elemen lab.bad · actions'],
      ],
    );
  });

  it('reports tool handler errors once and rethrows them', () => {
    const reporter = vi.fn();
    const error = new Error('down');
    const plugin = core.definePlugin({
      id: 'lab.p',
      tools: [
        core.defineTool({
          id: 'lab.t',
          initial: 'idle',
          states: {
            idle: {
              onPointerDown: () => {
                throw error;
              },
            },
          },
        }),
      ],
    });
    const tool = instrumentPlugin(plugin, reporter).tools![0]!;
    const handler = (tool.states as Record<string, { onPointerDown: () => void }>).idle!
      .onPointerDown;
    expect(() => handler()).toThrow(error);
    expect(() => handler()).toThrow(error);
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter.mock.calls[0]![0]).toMatchObject({
      kind: 'runtime',
      origin: 'tool lab.t · idle.onPointerDown',
    });
    expect(wasReported(error)).toBe(true);
  });

  it('produces definitions that still install', () => {
    const source = `
      import { defineElement, defineTool, definePlugin, schema } from '@kujam/core';
      export default definePlugin({
        id: 'lab.ok',
        elements: [defineElement({ type: 'lab.e', version: 1, props: schema({}), a11y: () => ({ role: 'img', label: 'e' }) })],
        tools: [defineTool({ id: 'lab.t', initial: 'idle', data: () => ({ n: 0 }), states: { idle: {} } })],
      });`;
    const plugins = compilePlugins(source, modules, () => {});
    const board = core.createBoard({ plugins });
    expect(board.elements.has('lab.e')).toBe(true);
    expect(board.tools.has('lab.t')).toBe(true);
    board.dispose();
  });
});
