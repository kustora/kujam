// Type tests for BOARD-1701: checked by `tsc --noEmit`, with no runtime code.
import type { Board, BoardDocument, Point } from '@kujam/core';
import type {
  ExportJSONOptions,
  exportJSON,
  ImportErrorCode,
  ImportJSONOptions,
  ImportResult,
  importJSON,
} from './index.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type Tests = [
  Expect<Equal<Parameters<typeof exportJSON>, [board: Board, options?: ExportJSONOptions]>>,
  Expect<Equal<ReturnType<typeof exportJSON>, BoardDocument>>,
  Expect<Equal<ExportJSONOptions['ids'], readonly string[] | undefined>>,
  Expect<
    Equal<Parameters<typeof importJSON>, [board: Board, json: unknown, options?: ImportJSONOptions]>
  >,
  Expect<Equal<ReturnType<typeof importJSON>, ImportResult>>,
  Expect<Equal<ImportJSONOptions['at'], Point | undefined>>,
  Expect<Equal<ImportResult['idMap'], ReadonlyMap<string, string>>>,
  Expect<Equal<ImportErrorCode, 'read-only' | 'document-too-new' | 'limit-exceeded' | 'forbidden'>>,
];
