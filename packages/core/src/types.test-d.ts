import type {
  attachStorage,
  defineBrush,
  resizeElements,
  rotateElements,
  snapTranslation,
} from './index.js';
import type { defaultCommands } from './index.js';
import type {
  DuplicateArgs,
  BoardKeybindings,
  Keybinding,
  KeyboardPlatform,
  ToolKeyEvent,
  AssetAdapter,
  AssetRecord,
  BindingRecord,
  Board,
  BoardCamera,
  CameraFollowOptions,
  BrushBlendMode,
  BrushDefinition,
  BrushInput,
  BrushRegistry,
  BrushStrokeOptions,
  ElementRenderers,
  PluginBrushDefinition,
  BoardDocument,
  BoardLimits,
  BoardRecord,
  BoardResolvers,
  BoardUser,
  ElementDefinition,
  ElementSize,
  ResizeHandle,
  ResizeOptions,
  ElementContext,
  ToolPointerEvent,
  SnapGuide,
  SnapOptions,
  RotateOptions,
  TransformResult,
  Bounds,
  BoxBounds,
  BoardPages,
  CameraState,
  BoardHistory,
  ChangeEvent,
  HistoryOptions,
  CreateBoardOptions,
  DeleteOptions,
  DocumentPropsValidator,
  DocumentTooNewReason,
  ElementAction,
  ElementActionContext,
  ElementInput,
  ReplaceElementsOptions,
  ReplaceElementFactory,
  ToolStyle,
  ToolStyles,
  ElementPatch,
  ElementRecord,
  ElementRegistry,
  ElementTransform,
  Geometry,
  HitTestOptions,
  MigrationError,
  MigrationSource,
  MutateOptions,
  TransactOptions,
  PathGeometry,
  Point,
  SnapPoint,
  PageInput,
  PageRecord,
  PartialElement,
  PreparedDocument,
  PermissionAction,
  PermissionHook,
  QueryFilter,
  RectBounds,
  SchemaMigration,
  SchemaMigrations,
  SelectionInput,
  StorageAttachment,
  StorageStatus,
  SaveErrorEvent,
  AttachStorageOptions,
  StorageAdapter,
  SpatialIndex,
  UpdateOptions,
  ViewportSize,
  ZoomRange,
  ZoomToOptions,
  CameraAnimation,
  FrameScheduler,
  ThemeDefinition,
  ThemeMode,
  ValidateDocumentOptions,
  ValidationResult,
} from './index.js';
import type { validateDocument } from './index.js';
import type { migrateSchema } from './index.js';

declare module './index.js' {
  interface BoardElementTypes {
    'custom-sticky': { note: string; priority: number };
    'tayang-post': { postId: string };
    sticky: { color: string; text?: string };
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
        pluginVersions?: Record<string, number>;
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
        typeVersion?: number;
        meta: Record<string, unknown>;
      }
    >
  >,
  // Generic props carry through.
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
  // BOARD-211: Board property type tests
  Expect<Equal<Board['resolvers'], BoardResolvers>>,
  Expect<Equal<Board['assets'], Readonly<AssetAdapter> | null>>,
  Expect<Equal<Board['user'], Readonly<BoardUser> | null>>,
  Expect<Equal<Board['limits'], Readonly<BoardLimits>>>,
  Expect<Equal<Board['permissions'], PermissionHook | null>>,
  Expect<Equal<Board['disposed'], boolean>>,
  // BOARD-211: CreateBoardOptions type tests
  Expect<Equal<CreateBoardOptions['resolvers'], BoardResolvers | undefined>>,
  Expect<Equal<CreateBoardOptions['assets'], AssetAdapter | undefined>>,
  Expect<Equal<CreateBoardOptions['user'], BoardUser | null | undefined>>,
  Expect<Equal<CreateBoardOptions['limits'], Partial<BoardLimits> | undefined>>,
  Expect<Equal<CreateBoardOptions['permissions'], PermissionHook | undefined>>,
  // BOARD-205 & BOARD-607: mutation type tests (create, update, delete)
  Expect<
    Equal<
      Parameters<Board['create']>,
      [
        element: PartialElement<Record<string, unknown>> & { type: string },
        options?: MutateOptions,
      ]
    >
  >,
  Expect<
    Equal<
      ReturnType<Board['create']>,
      Readonly<ElementRecord<Record<string, unknown>>> | undefined
    >
  >,
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
  Expect<Equal<ReplaceElementsOptions['force'], boolean | undefined>>,
  Expect<Equal<ReplaceElementsOptions['select'], boolean | undefined>>,
  Expect<Equal<ElementInput<{ text: string }>['props'], Partial<{ text: string }> | undefined>>,
  Expect<Equal<Parameters<Board['isReplacing']>, [id: string]>>,
  Expect<Equal<ReturnType<Board['isReplacing']>, boolean>>,
  Expect<Equal<PartialElement<{ text: string }>['props'], Partial<{ text: string }> | undefined>>,
  Expect<Equal<ElementPatch<{ text: string }>['props'], Partial<{ text: string }> | undefined>>,
  // BOARD-206 & BOARD-607: read type tests (query, spatial, typed props via declaration merging)
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
  // BOARD-212: permission type tests (can, runAction)
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
  // BOARD-1108: style actions for a selection and remembered tool styles
  Expect<Equal<Parameters<Board['getActions']>, [ids?: SelectionInput]>>,
  Expect<Equal<ReturnType<Board['getActions']>, readonly ElementAction[]>>,
  Expect<Equal<Board['toolStyles'], ToolStyles>>,
  Expect<Equal<ReturnType<ToolStyles['get']>, ToolStyle>>,
  Expect<ElementActionContext extends ElementContext ? true : false>,
  // BOARD-401: camera type tests
  Expect<Equal<Board['camera'], BoardCamera>>,
  Expect<Equal<ReturnType<BoardCamera['get']>, Readonly<CameraState>>>,
  Expect<Equal<Parameters<BoardCamera['set']>, [patch: Partial<CameraState>]>>,
  Expect<Equal<BoardCamera['zoomRange'], Readonly<ZoomRange>>>,
  Expect<Equal<BoardCamera['viewport'], Readonly<ViewportSize>>>,
  Expect<Equal<Parameters<BoardCamera['screenToBoard']>, [point: Point]>>,
  Expect<Equal<ReturnType<BoardCamera['boardToScreen']>, Point>>,
  Expect<Equal<ReturnType<BoardCamera['getViewportBounds']>, BoxBounds>>,
  Expect<Equal<Parameters<BoardCamera['zoomTo']>, [zoom: number, anchor?: Point]>>,
  Expect<Equal<Parameters<BoardCamera['zoomBy']>, [factor: number, anchor?: Point]>>,
  Expect<Equal<BoardCamera['following'], string | null>>,
  Expect<
    Equal<Parameters<BoardCamera['follow']>, [userId: string | null, options?: CameraFollowOptions]>
  >,
  Expect<Equal<Parameters<BoardCamera['unfollow']>, []>>,
  // BOARD-405: selection type tests
  Expect<Equal<Board['selection'], readonly string[]>>,
  Expect<Equal<Board['selectionBounds'], Readonly<BoxBounds> | null>>,
  Expect<Equal<SelectionInput, string | readonly string[]>>,
  Expect<Equal<Parameters<Board['select']>, [ids: SelectionInput]>>,
  Expect<Equal<Parameters<Board['addToSelection']>, [ids: SelectionInput]>>,
  Expect<Equal<Parameters<Board['removeFromSelection']>, [ids: SelectionInput]>>,
  Expect<Equal<ReturnType<Board['clearSelection']>, void>>,
  // BOARD-1601: storage attachment type tests
  Expect<
    Equal<
      Parameters<typeof attachStorage>,
      [board: Board, adapter: StorageAdapter, options: AttachStorageOptions]
    >
  >,
  Expect<Equal<ReturnType<typeof attachStorage>, StorageAttachment>>,
  Expect<Equal<StorageAttachment['ready'], Promise<void>>>,
  Expect<Equal<ReturnType<StorageAttachment['flush']>, Promise<boolean>>>,
  Expect<Equal<StorageStatus, 'loading' | 'idle' | 'pending' | 'saving' | 'error' | 'detached'>>,
  Expect<Equal<SaveErrorEvent['willRetry'], boolean>>,
  // BOARD-210: shared document validation with registry and limits
  Expect<
    Equal<
      Parameters<typeof validateDocument>,
      [doc: unknown, registry?: DocumentPropsValidator, options?: ValidateDocumentOptions]
    >
  >,
  Expect<Equal<ReturnType<typeof validateDocument>['invalidRecords'], Record<string, string[]>>>,
  Expect<Equal<ValidationResult['errors'], string[]>>,
  Expect<Equal<ValidateDocumentOptions['limits'], Partial<BoardLimits> | undefined>>,
  Expect<ElementRegistry extends DocumentPropsValidator ? true : false>,
  // BOARD-403 & BOARD-404: geometry library and hit-test type tests
  Expect<Equal<Parameters<Board['hitTest']>, [point: Point, options?: HitTestOptions]>>,
  Expect<Equal<ReturnType<Board['hitTest']>, Readonly<ElementRecord> | undefined>>,
  Expect<Equal<Extract<Geometry, { kind: 'path' }>, PathGeometry>>,
  Expect<Equal<SnapPoint['kind'], 'corner' | 'edge' | 'center'>>,
  // Element records can be passed wherever an ElementTransform is expected.
  Expect<ElementRecord extends ElementTransform ? true : false>,
  // BOARD-701..703: migration type tests
  Expect<Equal<SchemaMigration, (doc: BoardDocument) => BoardDocument>>,
  Expect<Equal<SchemaMigrations, Readonly<Record<number, SchemaMigration>>>>,
  Expect<
    Equal<
      Parameters<typeof migrateSchema>,
      [doc: BoardDocument, migrations?: SchemaMigrations, targetVersion?: number]
    >
  >,
  Expect<Equal<MigrationError['source'], MigrationSource | undefined>>,
  Expect<Equal<DocumentTooNewReason['kind'], 'schema' | 'element' | 'plugin'>>,
  Expect<Equal<ElementRecord['typeVersion'], number | undefined>>,
  Expect<Equal<BoardDocument['pluginVersions'], Record<string, number> | undefined>>,
  // BOARD-208: page API type tests
  Expect<Equal<Board['pages'], BoardPages>>,
  Expect<Equal<BoardPages['current'], string>>,
  Expect<Equal<ReturnType<BoardPages['list']>, readonly Readonly<PageRecord>[]>>,
  Expect<Equal<Parameters<BoardPages['create']>[0], PageInput | undefined>>,
  Expect<Equal<ReturnType<BoardPages['create']>, Readonly<PageRecord> | undefined>>,
  Expect<Equal<ReturnType<BoardPages['delete']>, readonly string[]>>,
  Expect<Equal<QueryFilter['allPages'], boolean | undefined>>,
  // BOARD-1701: preparing incoming documents without touching the board
  Expect<Equal<Parameters<Board['prepareDocument']>, [doc: BoardDocument]>>,
  Expect<Equal<ReturnType<Board['prepareDocument']>, PreparedDocument>>,
  Expect<Equal<PreparedDocument['tooNew'], DocumentTooNewReason | null>>,
  // BOARD-302: undo coalescing type tests
  Expect<Equal<TransactOptions['mergeKey'], string | undefined>>,
  Expect<Equal<MutateOptions['mergeKey'], string | undefined>>,
  Expect<Equal<ChangeEvent['mergeKey'], string | undefined>>,
  Expect<Equal<HistoryOptions['mergeWindowMs'], number | undefined>>,
  Expect<Equal<BoardHistory['mergeWindowMs'], number>>,
  Expect<Equal<ReturnType<typeof _dummyBoard.history.batch<number>>, number>>,
  Expect<Equal<Parameters<BoardHistory['batch']>[0], string>>,
  // BOARD-406: transform type tests
  Expect<Equal<ResizeHandle, 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'>>,
  Expect<
    Equal<
      Parameters<typeof resizeElements>,
      [
        elements: readonly Readonly<ElementRecord>[],
        handle: ResizeHandle,
        start: Point,
        current: Point,
        options?: ResizeOptions,
      ]
    >
  >,
  Expect<Equal<ReturnType<typeof rotateElements>, TransformResult[]>>,
  Expect<Equal<RotateOptions['snap'], number | undefined>>,
  Expect<Equal<ElementDefinition['minSize'], ElementSize | undefined>>,
  // BOARD-407: snap type tests
  Expect<Equal<Board['snapOptions'], Readonly<SnapOptions>>>,
  Expect<Equal<Parameters<Board['setSnapOptions']>, [patch: Partial<SnapOptions>]>>,
  Expect<Equal<CreateBoardOptions['snap'], Partial<SnapOptions> | undefined>>,
  Expect<Equal<SnapOptions['grid'], number | null>>,
  Expect<Equal<SnapGuide['axis'], 'x' | 'y'>>,
  Expect<
    Equal<
      ReturnType<typeof snapTranslation>,
      { readonly delta: Point; readonly guides: readonly SnapGuide[] }
    >
  >,
  // BOARD-504: keybindings
  Expect<Equal<Board['keybindings'], BoardKeybindings>>,
  Expect<Equal<KeyboardPlatform, 'mac' | 'other'>>,
  Expect<Equal<CreateBoardOptions['platform'], KeyboardPlatform | undefined>>,
  Expect<
    Equal<CreateBoardOptions['keybindings'], Readonly<Record<string, string | null>> | undefined>
  >,
  Expect<Equal<Parameters<BoardKeybindings['set']>, [shortcut: string, target: string | null]>>,
  Expect<Equal<ReturnType<BoardKeybindings['match']>, Keybinding | undefined>>,
  Expect<Equal<ToolKeyEvent['inTextInput'], boolean | undefined>>,
  // BOARD-505: built-in commands
  Expect<Equal<(typeof defaultCommands)['id'], 'default-commands'>>,
  Expect<Equal<DuplicateArgs['offset'], Point | undefined>>,
  // BOARD-502: tool feedback, element callbacks, and double clicks
  Expect<Equal<Board['toolData'], unknown>>,
  Expect<Equal<Board['elementContext'], ElementContext>>,
  Expect<Equal<ToolPointerEvent['clickCount'], number | undefined>>,
  // BOARD-402: fitting and camera animation
  Expect<Equal<Parameters<BoardCamera['zoomToBounds']>, [bounds: Bounds, options?: ZoomToOptions]>>,
  Expect<Equal<Parameters<BoardCamera['zoomToFit']>, [options?: ZoomToOptions]>>,
  Expect<Equal<ReturnType<BoardCamera['zoomToSelection']>, boolean>>,
  Expect<Equal<ZoomToOptions['animate'], boolean | CameraAnimation | undefined>>,
  Expect<Equal<BoardCamera['reducedMotion'], boolean>>,
  Expect<Equal<CreateBoardOptions['frameScheduler'], FrameScheduler | undefined>>,
  Expect<Equal<CreateBoardOptions['reducedMotion'], boolean | undefined>>,
  // BOARD-603: brushes
  Expect<Equal<Board['brushes'], BrushRegistry>>,
  Expect<Equal<Parameters<typeof defineBrush>, [definition: BrushInput]>>,
  Expect<Equal<ReturnType<typeof defineBrush>, BrushDefinition>>,
  Expect<Equal<ReturnType<BrushRegistry['resolve']>, Readonly<BrushDefinition>>>,
  Expect<Equal<BrushDefinition['blend'], BrushBlendMode>>,
  Expect<Equal<PluginBrushDefinition, BrushInput>>,
  Expect<Equal<BrushInput['strokeOptions'], BrushStrokeOptions | undefined>>,
  Expect<Equal<ReturnType<ElementContext['resolveBrush']>, Readonly<BrushDefinition>>>,
  Expect<Equal<ElementContext['theme'], Readonly<ThemeDefinition>>>,
  Expect<Equal<Board['theme'], Readonly<ThemeDefinition>>>,
  Expect<Equal<Parameters<Board['setTheme']>, [theme: ThemeMode | ThemeDefinition]>>,
  Expect<Equal<CreateBoardOptions['theme'], ThemeMode | ThemeDefinition | undefined>>,
  Expect<
    Equal<
      Parameters<NonNullable<ElementRenderers<unknown, undefined>['canvas']>>[4],
      ElementContext | undefined
    >
  >,
  // BOARD-607: declaration merging for getElement and create
  Expect<
    Equal<
      typeof _tayangPostEl,
      Readonly<ElementRecord<{ postId: string }>> | undefined
    >
  >,
  Expect<Equal<typeof _tayangPostId, string>>,
  Expect<
    Equal<
      ReturnType<typeof _dummyBoard.create<'tayang-post'>>,
      Readonly<ElementRecord<{ postId: string }>> | undefined
    >
  >,
];

declare const _dummyBoard: Board;
declare const _customEl: ReturnType<typeof _dummyBoard.getElement<'custom-sticky'>>;
declare const _customQuery: ReturnType<typeof _dummyBoard.query<'custom-sticky'>>;
declare const _tayangPostEl: ReturnType<typeof _dummyBoard.getElement<'tayang-post'>>;
declare const _tayangPostId: NonNullable<ReturnType<typeof _dummyBoard.getElement<'tayang-post'>>>['props']['postId'];

// BOARD-607: verify getElement<'tayang-post'>(id)?.props.postId is typed as string
if (_tayangPostEl) {
  const _testId: string = _tayangPostEl.props.postId;
  void _testId;
}

// BOARD-607: verify board.create({ type: 'sticky', props: ... }) enforces props type when mapped
_dummyBoard.create({
  type: 'tayang-post',
  props: { postId: '123' },
});
_dummyBoard.create({
  type: 'sticky',
  props: { color: 'yellow' },
});
_dummyBoard.create({
  type: 'unregistered',
  props: { anything: 123 },
});
declare const _partialElem: PartialElement;
_dummyBoard.create(_partialElem);

// @ts-expect-error wrong props for tayang-post (postId must be string)
_dummyBoard.create({ type: 'tayang-post', props: { postId: 123 } });

// @ts-expect-error wrong props for sticky (color must be string)
_dummyBoard.create({ type: 'sticky', props: { color: 42 } });
