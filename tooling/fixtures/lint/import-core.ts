// BOARD-106: fixture lint. Impor @kujam/core: sah untuk semua package kecuali core sendiri.
import { createBoard } from '@kujam/core';
import type { Board } from '@kujam/core/internal';

export const board: Board = createBoard();
