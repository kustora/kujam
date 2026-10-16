// Uji tipe untuk BOARD-601 di sisi shapes (diperiksa `tsc --noEmit`, tanpa kode runtime).
import type { AnyElementDefinition, ElementCanvasContext, ElementPropsOf } from '@kujam/core';
import type { defaultElements, geoElement, RichText, stickyElement } from './index.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// Konteks Canvas asli dari DOM bisa langsung diberikan ke `render.canvas`.
declare const dom: CanvasRenderingContext2D;
declare const offscreen: OffscreenCanvasRenderingContext2D;
const _dom: ElementCanvasContext = dom;
const _offscreen: ElementCanvasContext = offscreen;

// Elemen bawaan memakai tipe publik yang sama dengan elemen kustom.
const _all: readonly AnyElementDefinition[] = [] as unknown as typeof defaultElements;

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
  Expect<Equal<(typeof defaultElements)[number]['type'], 'sticky' | 'draw' | 'text' | 'geo'>>,
];
