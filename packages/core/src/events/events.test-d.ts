// Type tests for BOARD-207 and BOARD-301: the `board.on` event map is fully typed.
// Checked by `tsc --noEmit`.
import type {
  ActionEvent,
  Board,
  BoardErrorCode,
  BoardErrorEvent,
  BoardEventMap,
  CameraEvent,
  CameraFollowEvent,
  ChangeEvent,
  DragPreviewEvent,
  HistoryEvent,
  PageEvent,
  SelectionEvent,
  SyncChangeEvent,
  ThemeDefinition,
  ToolEvent,
  ToolStyleEvent,
} from '../index.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type ListenerArg<K extends keyof BoardEventMap> = Parameters<
  Parameters<Board['on']>[1] & ((event: BoardEventMap[K]) => void)
>[0];

export type Tests = [
  Expect<Equal<ListenerArg<'sync'>, SyncChangeEvent>>,
  Expect<
    Equal<
      keyof BoardEventMap,
      | 'change'
      | 'selection'
      | 'camera'
      | 'camera-follow'
      | 'follow'
      | 'tool'
      | 'tool-style'
      | 'page'
      | 'action'
      | 'data'
      | 'error'
      | 'history'
      | 'theme'
      | 'dispose'
      | 'drag-preview'
      | 'sync'
    >
  >,
  Expect<Equal<BoardEventMap['change'], ChangeEvent>>,
  Expect<Equal<BoardEventMap['selection'], SelectionEvent>>,
  Expect<Equal<BoardEventMap['camera'], CameraEvent>>,
  Expect<Equal<BoardEventMap['camera-follow'], CameraFollowEvent>>,
  Expect<Equal<BoardEventMap['follow'], CameraFollowEvent>>,
  Expect<Equal<BoardEventMap['tool'], ToolEvent>>,
  Expect<Equal<BoardEventMap['tool-style'], ToolStyleEvent>>,
  Expect<Equal<BoardEventMap['page'], PageEvent>>,
  Expect<Equal<BoardEventMap['action'], ActionEvent>>,
  Expect<Equal<BoardEventMap['error'], BoardErrorEvent>>,
  Expect<Equal<BoardEventMap['dispose'], undefined>>,
  Expect<Equal<BoardEventMap['drag-preview'], DragPreviewEvent>>,
  Expect<Equal<BoardEventMap['history'], HistoryEvent>>,
  Expect<Equal<BoardEventMap['theme'], Readonly<ThemeDefinition>>>,
  Expect<Equal<ListenerArg<'camera'>, CameraEvent>>,
  Expect<Equal<ListenerArg<'drag-preview'>, DragPreviewEvent>>,
  Expect<
    Equal<
      BoardErrorCode,
      | 'listener-error'
      | 'invalid-props'
      | 'invalid-record'
      | 'forbidden'
      | 'limit-exceeded'
      | 'document-too-new'
      | 'page-not-found'
      | 'render-error'
      | 'resolve-error'
      | 'action-error'
      | 'undo-hook-error'
      | 'drop-error'
    >
  >,
  Expect<Equal<ReturnType<Board['undo']>, boolean>>,
  Expect<Equal<Board['history']['canUndo'], boolean>>,
];

declare const board: Board;
board.on('camera', (e) => {
  const zoom: number = e.camera.zoom - e.previous.zoom;
  void zoom;
});
board.on('error', (e) => {
  const code: BoardErrorCode = e.code;
  void code;
});
// @ts-expect-error unknown events are rejected
board.on('tidak-ada', () => {});
// @ts-expect-error the `change` payload is not a CameraEvent
board.on('change', (e: CameraEvent) => void e);
