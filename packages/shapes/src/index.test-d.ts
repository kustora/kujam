// Uji tipe untuk BOARD-601 & BOARD-602 di sisi shapes (diperiksa `tsc --noEmit`, tanpa kode runtime).
import type {
  AnyElementDefinition,
  AnyPluginDefinition,
  ElementCanvasContext,
  ElementPropsOf,
} from '@kujam/core';
import type { defaultElements, defaultTools, geoElement, RichText, stickyElement } from './index.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// Konteks Canvas asli dari DOM bisa langsung diberikan ke `render.canvas`.
declare const dom: CanvasRenderingContext2D;
declare const offscreen: OffscreenCanvasRenderingContext2D;
const _dom: ElementCanvasContext = dom;
const _offscreen: ElementCanvasContext = offscreen;

// Elemen dan tool bawaan adalah plugin biasa (BOARD-602) dengan tipe publik yang sama.
const _plugins: readonly AnyPluginDefinition[] = [] as unknown as [
  typeof defaultElements,
  typeof defaultTools,
];
const _all: readonly AnyElementDefinition[] =
  [] as unknown as (typeof defaultElements)['elements'];

type StickyProps = ElementPropsOf<typeof stickyElement>;

export type Checks = [
  Expect<
    Equal<
      StickyProps,
      {
        text: RichText;
        color: 'yellow' | 'orange' | 'pink' | 'green' | 'blue' | 'violet';
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
];
