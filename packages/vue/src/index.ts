/**
 * `@kujam/vue` — Thin `Board` component adapter and composables for Vue 3.
 *
 * @packageDocumentation
 */

import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import type { Board as CoreBoard } from '@kujam/core';
import { mountRenderer, type BoardView } from '@kujam/renderer';

/**
 * Vue 3 `Board` component for mounting `@kujam/renderer`.
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

    // Remount the renderer when the board instance is replaced (same as the [board] dependency in React).
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
