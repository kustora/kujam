import { createBoard } from '@kujam/core';
import { mountRenderer } from '@kujam/renderer';

const container = document.getElementById('board');
if (container) {
  const board = createBoard({ locale: 'id' });
  mountRenderer(board, container);
}
