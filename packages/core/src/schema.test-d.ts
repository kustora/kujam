// Type tests for BOARD-203: checked by `tsc --noEmit` (pnpm typecheck), with no runtime code.
import type { Infer, OptionalSchema, Schema } from './schema.js';
import type {
  array,
  enumOf,
  literal,
  nullable,
  number,
  optional,
  schema,
  string,
} from './schema.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare const s: typeof schema;
declare const str: typeof string;
declare const num: typeof number;
declare const en: typeof enumOf;
declare const opt: typeof optional;
declare const nul: typeof nullable;
declare const arr: typeof array;
declare const lit: typeof literal;

const _props = s({
  kind: lit('sticky'),
  text: str(),
  size: en(['s', 'm', 'l']),
  align: opt(en(['left', 'right'])),
  link: nul(str()),
  points: arr(arr(num())),
});

export type Checks = [
  Expect<
    Equal<
      Infer<typeof _props>,
      {
        kind: 'sticky';
        text: string;
        size: 's' | 'm' | 'l';
        align?: 'left' | 'right';
        link: string | null;
        points: number[][];
      }
    >
  >,
  Expect<Equal<Infer<ReturnType<typeof opt<number>>>, number | undefined>>,
  Expect<Equal<ReturnType<typeof opt<number>>, OptionalSchema<number>>>,
  Expect<Equal<Infer<Schema<{ a: 1 }>>, { a: 1 }>>,
  // Negative test: required keys must not read as optional.
  Expect<Equal<Equal<Infer<typeof _props>, { kind: 'sticky' }>, false>>,
];
