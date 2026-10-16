// BOARD-007: inferensi tipe harus identik di keempat kandidat. Gagal = error tsc.
import type * as v from 'valibot';
import type { z } from 'zod';
import type { Infer } from './mini.ts';
import * as mini from './entries/mini.ts';
import * as vb from './entries/valibot.ts';
import * as zd from './entries/zod.ts';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type StickyExpected = {
  kind: 'sticky';
  text: string;
  color: 'yellow' | 'orange' | 'green' | 'blue' | 'violet' | 'pink';
  size: 's' | 'm' | 'l';
  fontSize: number;
  align?: 'left' | 'center' | 'right';
  link: string | null;
  locked: boolean;
  tags: string[];
};
type StrokeExpected = { points: number[][]; color: string; width: number; brush?: string };

export type Checks = [
  Expect<Equal<Infer<typeof mini.sticky>, StickyExpected>>,
  Expect<Equal<Infer<typeof mini.stroke>, StrokeExpected>>,
  Expect<Equal<Infer<typeof mini.card>, { refId: string; size: 's' | 'm' | 'l' }>>,
  Expect<Equal<v.InferOutput<typeof vb.sticky>, StickyExpected>>,
  Expect<Equal<z.infer<typeof zd.sticky>, StickyExpected>>,
];
