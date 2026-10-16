/**
 * `@kujam/vue` — Adapter tipis komponen `Board` dan composables untuk Vue 3.
 *
 * @packageDocumentation
 */

import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import type { Board as CoreBoard } from '@kujam/core';
import { mountRenderer, type BoardView } from '@kujam/renderer';

/**
 * Komponen Vue 3 `Board` untuk memasang `@kujam/renderer`.
 *
 * @public
 */
export const Board = defineComponent({
  name: 'KujamBoard',
  props: {
    board: {
      type: Object as PropType<CoreBoard>,
      required: true,
    },
  },
  setup(props) {
    const hostRef = ref<HTMLElement | null>(null);
    let view: BoardView | null = null;

    const mount = (): void => {
      view?.unmount();
      view = hostRef.value ? mountRenderer(props.board, hostRef.value) : null;
    };

    onMounted(mount);

    // Pasang ulang renderer bila instance board diganti (sama dengan dependensi [board] di React).
    watch(
      () => props.board,
      () => {
        if (view) mount();
      },
    );

    onBeforeUnmount(() => {
      view?.unmount();
      view = null;
    });

    return () =>
      h('div', {
        ref: hostRef,
        style: { width: '100%', height: '100%', position: 'relative' },
      });
  },
});
