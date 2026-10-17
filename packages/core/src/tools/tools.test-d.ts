// Type tests for BOARD-501: state names and `ctx.data` are inferred from the tool definition.
// Checked by `tsc --noEmit`.
import { defineTool, type Board, type BoardInputEvent, type ToolEvent } from '../index.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export const pen = defineTool({
  id: 'pen',
  initial: 'idle',
  data: () => ({ points: [] as { x: number; y: number }[] }),
  states: {
    idle: {
      onPointerDown(ctx, e) {
        ctx.data.points.push(e.point);
        const state: 'idle' | 'drawing' = ctx.state;
        void state;
        return 'drawing';
      },
    },
    drawing: {
      onPointerUp: () => 'idle',
      // @ts-expect-error -- 'menggambar' is not a state of this tool.
      onPointerMove: () => 'menggambar',
    },
  },
});

defineTool({
  id: 'salah',
  // @ts-expect-error -- initial must be one of the states keys.
  initial: 'diam',
  states: { idle: {} },
});

defineTool({
  id: 'data',
  initial: 'idle',
  data: () => ({ n: 0 }),
  states: {
    idle: {
      // @ts-expect-error -- ctx.data.n is a number.
      onEnter: (ctx) => void ctx.data.n.toUpperCase(),
    },
  },
});

export type Tests = [
  Expect<Equal<Board['tool'], string | null>>,
  Expect<Equal<Parameters<Board['dispatch']>[0], BoardInputEvent>>,
  Expect<Equal<ToolEvent['id'], string | null>>,
  Expect<
    Equal<
      BoardInputEvent['type'],
      | 'pointer-down'
      | 'pointer-move'
      | 'pointer-up'
      | 'pointer-cancel'
      | 'key-down'
      | 'key-up'
      | 'wheel'
      | 'pinch'
    >
  >,
];
