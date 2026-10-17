import type {
  AssetAdapter,
  AssetRecord,
  BindingRecord,
  Board,
  BoardDocument,
  BoardLimits,
  BoardRecord,
  BoardResolvers,
  BoardUser,
  Bounds,
  BoxBounds,
  ChangeEvent,
  CreateBoardOptions,
  DeleteOptions,
  ElementAction,
  ElementPatch,
  ElementRecord,
  MutateOptions,
  PageRecord,
  PartialElement,
  PermissionAction,
  PermissionHook,
  QueryFilter,
  RectBounds,
  SpatialIndex,
  UpdateOptions,
} from './index.js';

declare module './index.js' {
  interface BoardElementTypes {
    'custom-sticky': { note: string; priority: number };
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type Tests = [
  Expect<
    Equal<
      BoardDocument,
      {
        schemaVersion: number;
        meta: Record<string, unknown>;
        records: Record<string, BoardRecord>;
      }
    >
  >,
  Expect<Equal<BoardRecord, ElementRecord | BindingRecord | PageRecord | AssetRecord>>,
  Expect<Equal<BoardRecord['kind'], 'element' | 'binding' | 'page' | 'asset'>>,
  Expect<
    Equal<
      ElementRecord,
      {
        id: string;
        kind: 'element';
        type: string;
        pageId: string;
        parentId: string | null;
        index: string;
        x: number;
        y: number;
        rotation: number;
        w: number;
        h: number;
        locked: boolean;
        opacity: number;
        props: Record<string, unknown>;
        meta: Record<string, unknown>;
      }
    >
  >,
  // Props generik ikut terbawa.
  Expect<Equal<ElementRecord<{ text: string }>['props'], { text: string }>>,
  Expect<
    Equal<
      BindingRecord,
      {
        id: string;
        kind: 'binding';
        fromId: string;
        toId: string;
        anchor: { x: number; y: number };
      }
    >
  >,
  Expect<Equal<ChangeEvent['origin'], 'local' | 'remote' | 'undo' | 'redo' | 'load' | 'migration'>>,
  // BOARD-211: Uji tipe properti Board
  Expect<Equal<Board['resolvers'], BoardResolvers>>,
  Expect<Equal<Board['assets'], Readonly<AssetAdapter> | null>>,
  Expect<Equal<Board['user'], Readonly<BoardUser> | null>>,
  Expect<Equal<Board['limits'], Readonly<BoardLimits>>>,
  Expect<Equal<Board['permissions'], PermissionHook | null>>,
  Expect<Equal<Board['disposed'], boolean>>,
  // BOARD-211: Uji tipe CreateBoardOptions
  Expect<Equal<CreateBoardOptions['resolvers'], BoardResolvers | undefined>>,
  Expect<Equal<CreateBoardOptions['assets'], AssetAdapter | undefined>>,
  Expect<Equal<CreateBoardOptions['user'], BoardUser | null | undefined>>,
  Expect<Equal<CreateBoardOptions['limits'], Partial<BoardLimits> | undefined>>,
  Expect<Equal<CreateBoardOptions['permissions'], PermissionHook | undefined>>,
  // BOARD-205: Uji tipe mutasi (create, update, delete)
  Expect<
    Equal<
      Parameters<Board['create']>,
      [element: PartialElement<Record<string, unknown>>, options?: MutateOptions]
    >
  >,
  Expect<Equal<ReturnType<Board['create']>, Readonly<ElementRecord<unknown>> | undefined>>,
  Expect<
    Equal<
      Parameters<Board['update']>,
      [id: string, patch: ElementPatch<Record<string, unknown>>, options?: UpdateOptions]
    >
  >,
  Expect<Equal<ReturnType<Board['update']>, Readonly<ElementRecord<unknown>> | undefined>>,
  Expect<
    Equal<Parameters<Board['delete']>, [ids: string | Iterable<string>, options?: DeleteOptions]>
  >,
  Expect<Equal<ReturnType<Board['delete']>, readonly string[]>>,
  Expect<Equal<UpdateOptions['force'], boolean | undefined>>,
  Expect<Equal<DeleteOptions['force'], boolean | undefined>>,
  Expect<Equal<PartialElement<{ text: string }>['props'], Partial<{ text: string }> | undefined>>,
  Expect<Equal<ElementPatch<{ text: string }>['props'], Partial<{ text: string }> | undefined>>,
  // BOARD-206 & BOARD-607: Uji tipe baca (query, spatial, typed props via declaration merging)
  Expect<Equal<Parameters<Board['query']>, [filter?: QueryFilter]>>,
  Expect<Equal<ReturnType<Board['query']>, readonly Readonly<ElementRecord<unknown>>[]>>,
  Expect<Equal<Board['spatial'], SpatialIndex>>,
  Expect<Equal<Bounds, BoxBounds | RectBounds>>,
  Expect<
    Equal<typeof _customEl, Readonly<ElementRecord<{ note: string; priority: number }>> | undefined>
  >,
  Expect<
    Equal<
      typeof _customQuery,
      readonly Readonly<ElementRecord<{ note: string; priority: number }>>[]
    >
  >,
  // BOARD-212: Uji tipe izin (can, runAction)
  Expect<
    Equal<
      Parameters<Board['can']>,
      [action: PermissionAction, element?: Readonly<ElementRecord> | null]
    >
  >,
  Expect<Equal<ReturnType<Board['can']>, boolean>>,
  Expect<
    Equal<Parameters<Board['runAction']>, [action: ElementAction, element: Readonly<ElementRecord>]>
  >,
  Expect<Equal<ReturnType<Board['runAction']>, boolean>>,
];

declare const _dummyBoard: Board;
declare const _customEl: ReturnType<typeof _dummyBoard.getElement<'custom-sticky'>>;
declare const _customQuery: ReturnType<typeof _dummyBoard.query<'custom-sticky'>>;
