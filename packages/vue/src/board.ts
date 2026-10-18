/**
 * Vue 3 `<Board>` component (BOARD-1303).
 */

import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import type { Board as CoreBoard, ThemeDefinition, ThemeMode } from '@kujam/core';
import { mountRenderer, type BoardBackground, type BoardView } from '@kujam/renderer';

/**
 * Mounts `@kujam/renderer` for `board` and unmounts it with the component (BOARD-1303).
 *
 * Changing `board` unmounts the old view and mounts a new one; `theme`, `background`, and `debug`
 * apply to the mounted view without remounting. The component fills its parent, so give the
 * parent a size. It never disposes the board, since the app owns it.
 *
 * Events:
 * - `mount` (view): the view was mounted, for example to call `view.mountEditor`;
 * - `unmount` (view): the view is about to unmount;
 * - `clipboard-error` (error): pasted board content was rejected (BOARD-906).
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * const board = createBoard({ plugins: [defaultElements, defaultTools] });
 * </script>
 * <template>
 *   <Board :board="board" theme="light" style="height: 600px" />
 * </template>
 * ```
 * @public
 */
export const Board = defineComponent({
  name: 'KujamBoard',
  props: {
    /** The board to render. */
    board: { type: Object as PropType<CoreBoard>, required: true },
    /** Theme mode or definition (BOARD-1006). Applied with `board.setTheme` when it changes. */
    theme: { type: [String, Object] as PropType<ThemeMode | ThemeDefinition>, default: undefined },
    /** Background pattern (BOARD-1007). Defaults to `dots`. */
    background: { type: String as PropType<BoardBackground>, default: undefined },
    /** Visual debug overlays and render stats (BOARD-802). */
    debug: { type: Boolean, default: false },
    /** Device pixel ratio for the canvases. Read when the view mounts. */
    pixelRatio: { type: Number, default: undefined },
  },
  emits: {
    mount: (view: BoardView) => Boolean(view),
    unmount: (view: BoardView) => Boolean(view),
    'clipboard-error': (error: unknown) => error !== undefined,
  },
  setup(props, { emit }) {
    const host = ref<HTMLElement | null>(null);
    let view: BoardView | null = null;

    function unmount(): void {
      if (!view) return;
      const current = view;
      view = null;
      emit('unmount', current);
      current.unmount();
    }

    function mount(): void {
      unmount();
      if (!host.value || props.board.disposed) return;
      view = mountRenderer(props.board, host.value, {
        theme: props.theme,
        background: props.background,
        debug: props.debug,
        pixelRatio: props.pixelRatio,
        onClipboardError: (error) => emit('clipboard-error', error),
      });
      emit('mount', view);
    }

    onMounted(mount);
    onBeforeUnmount(unmount);

    watch(
      () => props.board,
      () => {
        if (host.value) mount();
      },
    );
    watch(
      () => props.theme,
      (theme) => {
        if (theme !== undefined && !props.board.disposed) props.board.setTheme(theme);
      },
    );
    watch(
      () => props.background,
      (background) => {
        if (view?.mounted) view.background = background ?? 'dots';
      },
    );
    watch(
      () => props.debug,
      (debug) => {
        if (view?.mounted) view.debug = debug;
      },
    );

    return () =>
      h('div', {
        ref: host,
        style: { width: '100%', height: '100%', position: 'relative' },
      });
  },
});
