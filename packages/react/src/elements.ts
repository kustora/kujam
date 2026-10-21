/**
 * Standalone helper for defining React whiteboard elements (BOARD-1304).
 */

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  defineElement,
  object,
  rect,
  type ElementA11y,
  type ElementAction,
  type ElementActionContext,
  type ElementContext,
  type ElementDefinition,
  type ElementExporters,
  type ElementHtmlHost,
  type ElementHtmlView,
  type ElementLod,
  type ElementMigrations,
  type ElementPlaceholder,
  type ElementRecord,
  type ElementRenderers,
  type ElementResize,
  type ElementResolveContext,
  type ElementSize,
  type Geometry,
  type InferShape,
  type ObjectSchema,
  type ResolveErrorStatus,
  type ResolveResult,
  type SchemaShape,
} from '@kujam/core';
import {
  enableInteractive,
  findPortalBridge,
  type CustomElementComponent,
} from './portal-bridge.js';

/**
 * Options for {@link defineReactElement}.
 *
 * @public
 */
export interface DefineReactElementOptions<
  T extends string = string,
  S extends SchemaShape = Record<string, never>,
  D = unknown,
> {
  /** Element type name. Unique per registry, no spaces. */
  readonly type: T;
  /** Custom React component to render the element. */
  readonly component: CustomElementComponent<InferShape<S>, D>;
  /** Props schema version, an integer starting at 1. Defaults to 1. */
  readonly version?: number;
  /** Props schema. Defaults to an empty object schema. */
  readonly props?: ObjectSchema<S>;
  /** Default props values for new elements. */
  readonly defaults?: Partial<InferShape<S>>;
  /** Local geometry for hit-testing, snapping, and selection. Defaults to `(el) => rect(el.w, el.h)`. */
  readonly geometry?: (el: ElementRecord<InferShape<S>>) => Geometry;
  /** Resize behavior; defaults to `'free'`. */
  readonly resize?: ElementResize<InferShape<S>>;
  /** Smallest size interactive resizing may produce, in board units. */
  readonly minSize?: ElementSize;
  /** Whether connectors can start from this element. Defaults to `false`. */
  readonly connectable?: boolean;
  /** Fetches external data (BOARD-604). */
  readonly resolve?: (el: ElementRecord<InferShape<S>>, ctx: ElementResolveContext) => ResolveResult<D>;
  /** Level-of-detail settings (BOARD-1204). */
  readonly lod?: ElementLod;
  /** Element contextual actions (BOARD-605). */
  readonly actions?: (
    el: ElementRecord<InferShape<S>>,
    data: D | undefined,
    ctx: ElementActionContext<InferShape<S>>,
  ) => readonly ElementAction[];
  /** Placeholder shown in place of the element while its data is loading or unavailable. */
  readonly placeholder?: (reason: ResolveErrorStatus | 'loading') => ElementPlaceholder;
  /** How the element is drawn on canvas or custom export/a11y. */
  readonly render?: ElementRenderers<InferShape<S>, D>;
  /** Called when the element is double-clicked. */
  readonly onDoubleClick?: (el: ElementRecord<InferShape<S>>, ctx: ElementContext) => void;
  /** Accessibility role and label. */
  readonly a11y?: (
    el: ElementRecord<InferShape<S>>,
    data: D | undefined,
    ctx: ElementContext,
  ) => ElementA11y;
  /** Element exporters. */
  readonly export?: ElementExporters<InferShape<S>, D>;
  /** Props migrations from older versions. */
  readonly migrate?: ElementMigrations;
}

/**
 * Fallback renderer when an element is mounted outside `<Board>`:
 * uses `createRoot` directly on `host`.
 */
function mountWithCreateRoot<P, D>(
  host: HTMLElement,
  el: ElementRecord<P>,
  data: D | undefined,
  Component: CustomElementComponent<P, D>,
): ElementHtmlView<P, D> {
  const root: Root = createRoot(host);
  let currentEl = el;
  let currentData = data;
  let disposed = false;

  const renderComponent = () => {
    if (disposed) return;
    enableInteractive(host);
    root.render(
      createElement(Component, {
        element: currentEl,
        data: currentData,
        status: 'ready',
        board: undefined as never,
      }),
    );
    queueMicrotask(() => {
      if (!disposed) enableInteractive(host);
    });
  };

  renderComponent();

  return {
    update(nextEl, nextData) {
      currentEl = nextEl;
      currentData = nextData;
      renderComponent();
    },
    destroy() {
      disposed = true;
      root.unmount();
    },
  };
}

/**
 * Defines a custom whiteboard element rendered with a React component (BOARD-1304).
 *
 * Inside `<Board>`, the component is mounted via a React Portal, inheriting all
 * React contexts from the host application. Outside `<Board>` (e.g. in standalone
 * renderer instances or headless tests), it falls back to `createRoot`.
 *
 * @example
 * ```tsx
 * export const postCardElement = defineReactElement({
 *   type: 'tayang-post',
 *   component: PostCard,
 *   props: object({ postId: string() }),
 * });
 * ```
 *
 * @public
 */
export function defineReactElement<
  const T extends string,
  S extends SchemaShape = Record<string, never>,
  D = unknown,
>(
  options: DefineReactElementOptions<T, S, D>,
): ElementDefinition<T, S, D> {
  const {
    type,
    component,
    version = 1,
    props = object({} as S) as ObjectSchema<S>,
    defaults,
    geometry = (el) => rect(el.w, el.h),
    render: userRender,
    resolve,
    ...rest
  } = options;

  const htmlRenderer = (
    host: ElementHtmlHost,
    el: ElementRecord<InferShape<S>>,
    data: D | undefined,
    _ctx: ElementContext,
  ): ElementHtmlView<InferShape<S>, D> => {
    const bridge = findPortalBridge(host as HTMLElement);
    if (bridge) {
      return bridge.mount(host as HTMLElement, el, data, component);
    }
    return mountWithCreateRoot(host as HTMLElement, el, data, component);
  };

  return defineElement({
    ...rest,
    type,
    version,
    props,
    defaults,
    geometry,
    resolve,
    render: {
      ...userRender,
      html: htmlRenderer,
    },
  } as any) as unknown as ElementDefinition<T, S, D>;
}
