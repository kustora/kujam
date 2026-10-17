// Type tests for BOARD-503: typed command arguments in `run` and `isEnabled`.
// Checked by `tsc --noEmit`.
import { defineCommand, type Board, type BoardCommands, type CommandDefinition } from '../index.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export const nudge = defineCommand<{ dx: number }>({
  id: 'contoh.geser',
  label: 'command.contoh.geser',
  isEnabled: (board, args) => !board.readOnly && (args?.dx ?? 0) !== 0,
  run: (_board, args) => {
    const dx: number | undefined = args?.dx;
    void dx;
  },
});

defineCommand<{ dx: number }>({
  id: 'contoh.salah',
  label: 'l',
  // @ts-expect-error -- `dx` is a number, not a string.
  run: (_board, args) => args?.dx.toUpperCase(),
});

export type Tests = [
  Expect<Equal<typeof nudge, CommandDefinition<{ dx: number }>>>,
  Expect<Equal<Board['run'], (id: string, args?: unknown) => boolean>>,
  Expect<Equal<Board['commands'], BoardCommands>>,
  Expect<Equal<ReturnType<BoardCommands['register']>, () => void>>,
];
