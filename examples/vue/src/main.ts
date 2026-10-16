import { createApp, h } from 'vue';
import { createBoard } from '@kujam/core';
import { Board } from '@kujam/vue';

const board = createBoard({ locale: 'id' });

createApp({
  render() {
    return h(Board, { board });
  },
}).mount('#app');

