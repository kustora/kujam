/**
 * Vue 3 `<Board>` component (BOARD-1303, BOARD-1305).
 */

import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  shallowRef,
  Teleport,
  watch,
  type Component,
  type PropType,
} from 'vue';
import {
  object,
  rect,
  type Board as CoreBoard,
  type ElementContext,
  type ElementHtmlHost,
  type ElementRecord,
  type ThemeDefinition,
  type ThemeMode,
} from '@kujam/core';
import { mountRenderer, type BoardBackground, type BoardView } from '@kujam/renderer';
import {
  enableInteractive,
  registerTeleportBridge,
  TeleportBridge,
  type CustomVueComponent,
  type CustomVueElementProps,
  type ElementDataStatus,
  type TeleportEntry,
} from './teleport-bridge.js';
import { defineVueElement, type DefineVueElementOptions } from './elements.js';

export {
  type CustomVueComponent,
  type CustomVueElementProps,
  type DefineVueElementOptions,
  type ElementDataStatus,
  defineVueElement,
};

const TeleportItem = defineComponent({
  name: 'KujamTeleportItem',
  props: {
    entry: { type: Object as PropType<TeleportEntry>, required: true },
  },
  setup(props) {
    onMounted(() => {
      enableInteractive(props.entry.host);
    });
    onUpdated(() => {
      enableInteractive(props.entry.host);
    });
    return () => {
      const { component: Comp, element, data, status, board } = props.entry;
      return h(Comp as Component, {
        element,
        data,
        status,
        board,
      });
    };
  },
});

/**
 * Mounts `@kujam/renderer` for `board` and unmounts it with the component (BOARD-1303, BOARD-1305).
 *
 * Changing `board` unmounts the old view and mounts a new one; `theme`, `background`, and `debug`
 * apply to the mounted view without remounting. The component fills its parent, so give the
 * parent a size. It never disposes the board, since the app owns it.
 *
 * Custom Vue elements passed via `elements` are rendered with Vue 3 `<Teleport>` into their respective
 * HTML host nodes, preserving application `provide`/`inject` hierarchy and maintaining high performance
 * under a single Vue app tree.
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
 *   <Board :board="board" :elements="{ 'tayang-post': PostCard }" theme="light" style="height: 600px" />
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
    /**
     * Custom Vue components for rendering elements by element type (BOARD-1305).
     * Rendered via Vue 3 `<Teleport>` to preserve provide/inject context and maintain performance.
     */
    elements: {
      type: Object as PropType<Readonly<Record<string, Component>>>,
      default: undefined,
    },
  },
  emits: {
    mount: (view: BoardView) => Boolean(view),
    unmount: (view: BoardView) => Boolean(view),
    'clipboard-error': (error: unknown) => error !== undefined,
  },
  setup(props, { emit }) {
    const host = ref<HTMLElement | null>(null);
    let view: BoardView | null = null;
    let cleanupBoard: (() => void) | null = null;
    const bridge = shallowRef(new TeleportBridge(props.board, () => props.elements));

    function unmount(): void {
      if (cleanupBoard) {
        cleanupBoard();
        cleanupBoard = null;
      }
      if (!view) return;
      const current = view;
      view = null;
      emit('unmount', current);
      current.unmount();
    }

    function mount(): void {
      unmount();
      if (!host.value || props.board.disposed) return;

      const currentBoard = props.board;
      const currentBridge = bridge.value;

      const unregisterBridge = registerTeleportBridge(host.value, currentBoard, currentBridge);

      // Ensure elements from `elements` prop are registered or intercepted
      for (const [type, Component] of Object.entries(props.elements ?? {})) {
        if (!currentBoard.elements.has(type)) {
          try {
            currentBoard.elements.register(
              defineVueElement({
                type,
                component: Component,
              }),
            );
          } catch {
            // Ignore if already registered
          }
        }
      }

      const origGet = currentBoard.elements.get.bind(currentBoard.elements);
      const origHas = currentBoard.elements.has.bind(currentBoard.elements);

      currentBoard.elements.get = (type: string) => {
        const existing = origGet(type);
        const vueComp = currentBridge.getComponent(type);
        if (!vueComp) return existing;

        if (existing) {
          return {
            ...existing,
            render: {
              ...existing.render,
              html: (
                elHost: ElementHtmlHost,
                el: ElementRecord<unknown>,
                data: unknown,
                _ctx: ElementContext,
              ) => {
                return currentBridge.mount(elHost as HTMLElement, el, data, vueComp);
              },
            },
          };
        }

        return {
          type,
          version: 1,
          props: object({}),
          defaults: {},
          geometry: (el: ElementRecord<unknown>) => rect(el.w, el.h),
          render: {
            html: (
              elHost: ElementHtmlHost,
              el: ElementRecord<unknown>,
              data: unknown,
              _ctx: ElementContext,
            ) => {
              return currentBridge.mount(elHost as HTMLElement, el, data, vueComp);
            },
          },
        } as unknown as ReturnType<typeof origGet>;
      };

      currentBoard.elements.has = (type: string) => {
        if (currentBridge.getComponent(type)) return true;
        return origHas(type);
      };

      cleanupBoard = () => {
        currentBoard.elements.get = origGet;
        currentBoard.elements.has = origHas;
        unregisterBridge();
      };

      view = mountRenderer(currentBoard, host.value, {
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
      (nextBoard) => {
        bridge.value = new TeleportBridge(nextBoard, () => props.elements);
        if (host.value) mount();
      },
    );
    watch(
      () => props.elements,
      (nextElements) => {
        bridge.value.setElementsGetter(() => nextElements);
        bridge.value.updateComponents();
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

    return () => {
      const teleportEntries = bridge.value.entriesRef.value;
      return h(
        'div',
        {
          ref: host,
          style: { width: '100%', height: '100%', position: 'relative' },
        },
        teleportEntries.map((entry) =>
          h(
            Teleport,
            { to: entry.host, key: entry.id },
            [h(TeleportItem, { entry: { ...entry } })],
          ),
        ),
      );
    };
  },
});
