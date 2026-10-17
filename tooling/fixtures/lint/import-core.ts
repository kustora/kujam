// BOARD-106: lint fixture. Importing @kujam/core: valid for every package except core itself.
import { createBoard } from '@kujam/core';
import type { Board } from '@kujam/core/internal';

export const board: Board = createBoard();
