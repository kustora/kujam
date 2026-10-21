/**
 * Reusable contract checks for custom element definitions (BOARD-1207).
 *
 * `testElementContract(def, options)` exercises every callback of a definition the way the board
 * and renderers call it, with sample data and every data state, and returns the problems found.
 * It needs no test framework: `expect(testElementContract(def, { data })).toEqual([])` works in
 * Vitest, Jest, or anything else. DOM rendering is checked when `createHost` is given (for
 * example `() => document.createElement('div')` under happy-dom or jsdom).
 */

import { validate } from '../document/schema.js';
import { containsPoint, resolveElementGeometry } from '../geometry/geometry.js';
import type { ElementRecord } from '../types.js';
import type {
  AnyElementDefinition,
  ElementCanvasContext,
  ElementContext,
  ElementLodState,
  ResolveErrorStatus,
} from './elements.js';

/**
 * One problem found by {@link testElementContract}.
 *
 * @beta
 */
export interface ElementContractIssue {
  /** Part of the contract, for example `defaults`, `render.html`, or `placeholder`. */
  readonly check: string;
  readonly message: string;
}

/**
 * Options for {@link testElementContract}.
 *
 * @beta
 */
export interface ElementContractOptions {
  /** Props of the sample element. Defaults to the definition's `defaults`. */
  readonly props?: Readonly<Record<string, unknown>>;
  /** Sample resolved data, passed to `render`, `actions`, and `a11y` as the ready state. */
  readonly data?: unknown;
  /**
   * Values the mock resolvers return, by resolver name. Resolvers not listed return `data`.
   * Used to check that `resolve` runs.
   */
  readonly resolvers?: Readonly<Record<string, (id: string) => unknown>>;
  /** Creates an empty host element; enables the `render.html` checks. */
  readonly createHost?: () => unknown;
  /** Sample size. Defaults to 200 × 120. */
  readonly size?: { readonly w: number; readonly h: number };
}

const REASONS: readonly (ResolveErrorStatus | 'loading')[] = [
  'loading',
  'forbidden',
  'not-found',
  'error',
];

/** A canvas context that accepts every call and property, for render checks without a canvas. */
function recordingCanvas(): ElementCanvasContext {
  const state: Record<string, unknown> = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  };
  return new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: String(text).length * 7 });
      if (key === 'getLineDash') return () => [];
      return () => undefined;
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as ElementCanvasContext;
}

const context: ElementContext = Object.freeze({
  locale: 'id',
  theme: undefined as never,
  emit: () => {},
  resolveBrush: () => undefined as never,
});

/**
 * Runs the contract checks of a custom element definition and returns every problem found
 * (an empty array when the element follows the contract).
 *
 * Checked: `defaults` pass the props schema; geometry is finite and contains the center;
 * `resolve` runs with mock resolvers and returns data, a `ResolveError`, or a promise;
 * `render.canvas` draws without throwing with and without data; `render.html` (with
 * `createHost`) returns `{ update, destroy }` that run without throwing; `placeholder` returns a
 * string label for every reason and never needs data; `actions` returns valid actions;
 * `a11y` returns string role and label; `export.text` returns a string.
 *
 * @beta
 */
export function testElementContract(
  definition: AnyElementDefinition,
  options: ElementContractOptions = {},
): ElementContractIssue[] {
  const issues: ElementContractIssue[] = [];
  const fail = (check: string, message: string) => issues.push({ check, message });
  const attempt = <T>(check: string, run: () => T): T | undefined => {
    try {
      return run();
    } catch (error) {
      fail(check, `threw: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };

  const props = { ...(definition.defaults ?? {}), ...(options.props ?? {}) };
  const result = validate(definition.props, props);
  if (!result.ok) {
    fail(
      'defaults',
      `sample props fail the schema: ${result.issues.map((i) => i.message).join('; ')}`,
    );
  }

  const { w, h } = options.size ?? { w: 200, h: 120 };
  const el = {
    id: 'contract-sample',
    kind: 'element',
    type: definition.type,
    pageId: 'page:contract',
    parentId: null,
    index: 'a0',
    x: 0,
    y: 0,
    w,
    h,
    rotation: 0,
    locked: false,
    opacity: 1,
    props,
    meta: {},
  } as ElementRecord;
  const def = definition as AnyElementDefinition & Record<string, unknown>;

  // Geometry
  if (def.geometry) {
    const geometry = attempt('geometry', () =>
      resolveElementGeometry(el, () => definition.geometry!(el as never)),
    );
    if (geometry && !containsPoint(geometry, { x: w / 2, y: h / 2 }, { element: el })) {
      fail('geometry', 'the center of the element is not inside its geometry');
    }
  }

  // resolve
  if (definition.resolve) {
    const names = new Set<string>();
    const resolvers = new Proxy(
      {},
      {
        get: (_target, name: string) => {
          names.add(name);
          return options.resolvers?.[name] ?? (() => options.data);
        },
      },
    ) as Readonly<Record<string, (id: string) => unknown>>;
    const value = attempt('resolve', () => definition.resolve!(el as never, { resolvers }));
    if (value === undefined && issues.at(-1)?.check !== 'resolve' && options.data !== undefined) {
      fail('resolve', 'returned undefined although the resolvers returned data');
    }
    if (names.size === 0 && issues.every((i) => i.check !== 'resolve')) {
      fail('resolve', 'did not call any resolver, so invalidate cannot reach the element');
    }
  } else if (options.data !== undefined) {
    fail('resolve', 'sample data was given but the definition has no resolve');
  }

  // render.canvas, with and without data, normal and compact
  if (definition.render?.canvas) {
    const lods: ElementLodState[] = [
      { zoom: 1, compact: false },
      { zoom: 0.2, compact: true },
    ];
    for (const data of [options.data, undefined]) {
      for (const lod of lods) {
        attempt(`render.canvas${data === undefined ? ' (no data)' : ''}`, () =>
          definition.render!.canvas!(recordingCanvas(), el as never, data as never, lod, context),
        );
      }
    }
  }

  // render.html
  if (definition.render?.html && options.createHost) {
    const host = options.createHost();
    const view = attempt('render.html', () =>
      definition.render!.html!(host as never, el as never, options.data as never, context),
    );
    if (view !== undefined) {
      if (typeof view?.update !== 'function' || typeof view?.destroy !== 'function') {
        fail('render.html', 'must return { update(el, data), destroy() }');
      } else {
        attempt('render.html update', () => view.update(el as never, options.data as never));
        attempt('render.html update (no data)', () => view.update(el as never, undefined));
        attempt('render.html destroy', () => view.destroy());
      }
    }
  }

  // placeholder
  if (definition.placeholder) {
    for (const reason of REASONS) {
      const placeholder = attempt(`placeholder(${reason})`, () => definition.placeholder!(reason));
      if (placeholder !== undefined && typeof placeholder?.label !== 'string') {
        fail(`placeholder(${reason})`, 'must return { label: string }');
      }
    }
  }

  // actions
  if (definition.actions) {
    const actionCtx = {
      ...context,
      user: null,
      updateProps: () => true,
      toolStyles: { get: () => undefined, set: () => {} },
      brushes: [],
    };
    for (const data of [options.data, undefined]) {
      const list = attempt('actions', () =>
        definition.actions!(el as never, data as never, actionCtx as never),
      );
      if (list === undefined) continue;
      if (!Array.isArray(list)) {
        fail('actions', 'must return an array');
        continue;
      }
      const ids = new Set<string>();
      for (const action of list) {
        if (typeof action?.id !== 'string' || action.id === '')
          fail('actions', 'every action needs an id');
        else if (ids.has(action.id)) fail('actions', `duplicate action id "${action.id}"`);
        else ids.add(action.id);
        if (typeof action?.label !== 'string')
          fail('actions', `action "${action?.id}" needs a label`);
        if (typeof action?.run !== 'function')
          fail('actions', `action "${action?.id}" needs run()`);
      }
    }
  }

  // a11y
  if (definition.a11y) {
    for (const data of [options.data, undefined]) {
      const a11y = attempt('a11y', () => definition.a11y!(el as never, data as never, context));
      if (
        a11y !== undefined &&
        (typeof a11y?.role !== 'string' || typeof a11y?.label !== 'string')
      ) {
        fail('a11y', 'must return string role and label');
      }
    }
  }

  // export.text
  if (definition.export?.text) {
    const text = attempt('export.text', () =>
      definition.export!.text!(el as never, options.data as never),
    );
    if (text !== undefined && typeof text !== 'string') fail('export.text', 'must return a string');
  }

  // references (BOARD-1802)
  if (definition.references) {
    const refs = attempt('references', () => definition.references!(el as never));
    if (refs !== undefined) {
      if (!Array.isArray(refs)) {
        fail('references', 'must return an array');
      } else {
        for (const ref of refs) {
          if (typeof ref?.resolver !== 'string' || ref.resolver === '') {
            fail('references', 'every reference needs a string resolver');
          }
          if (typeof ref?.id !== 'string' || ref.id === '') {
            fail('references', 'every reference needs a string id');
          }
        }
      }
    }
  }

  return issues;
}
