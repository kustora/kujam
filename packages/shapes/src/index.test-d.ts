// Type tests for BOARD-601 & BOARD-602 on the shapes side (checked by `tsc --noEmit`, with no runtime code).
import type {
  AnyElementDefinition,
  AnyPluginDefinition,
  ElementCanvasContext,
  BoxBounds,
  ElementPropsOf,
  SnapGuide,
} from '@kujam/core';
import type {
  defaultElements,
  defaultTools,
  geoElement,
  RichText,
  SelectToolData,
  stickyElement,
} from './index.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// A real DOM Canvas context can be passed directly to `render.canvas`.
declare const dom: CanvasRenderingContext2D;
declare const offscreen: OffscreenCanvasRenderingContext2D;
const _dom: ElementCanvasContext = dom;
const _offscreen: ElementCanvasContext = offscreen;

// Built-in elements and tools are ordinary plugins (BOARD-602) with the same public types.
const _plugins: readonly AnyPluginDefinition[] = [] as unknown as [
  typeof defaultElements,
  typeof defaultTools,
];
const _all: readonly AnyElementDefinition[] = [] as unknown as (typeof defaultElements)['elements'];

type StickyProps = ElementPropsOf<typeof stickyElement>;

export type Checks = [
  Expect<
    Equal<
      StickyProps,
      {
        text: RichText;
        color: 'yellow' | 'green' | 'pink' | 'blue' | 'purple' | 'gray';
        authorId: string | null;
      }
    >
  >,
  Expect<Equal<ElementPropsOf<typeof geoElement>['fill'], 'none' | 'semi' | 'solid'>>,
  Expect<Equal<(typeof defaultElements)['id'], 'default-elements'>>,
  Expect<Equal<(typeof defaultTools)['id'], 'default-tools'>>,
  Expect<
    Equal<(typeof defaultElements)['elements'][number]['type'], 'sticky' | 'draw' | 'text' | 'geo'>
  >,
  // BOARD-502: built-in select and hand tools, and the overlay data of the select tool.
  Expect<Equal<NonNullable<(typeof defaultTools)['tools']>[number]['id'], string>>,
  Expect<Equal<NonNullable<(typeof defaultTools)['tools']>['length'], 9>>,
  Expect<Equal<SelectToolData['brush'], BoxBounds | null>>,
  Expect<Equal<SelectToolData['guides'], readonly SnapGuide[]>>,
];
