/**
 * Vue 3 wrappers for the `@kujam/ui` Web Components (BOARD-1410).
 *
 * Each wrapper renders the custom element by tag name and passes `board` (and element-specific
 * properties) as DOM properties. The adapter does not import `@kujam/ui` (BOARD-106: adapters only
 * depend on core and renderer), so the application registers the elements once with
 * `defineUiElements()` from `@kujam/ui`; until then the tag stays an unknown element and a
 * development warning is logged. Templates need no `isCustomElement` setting, since the wrappers
 * create the elements in render functions.
 */

import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type DefineComponent,
  type PropType,
} from 'vue';
import type { Board as CoreBoard } from '@kujam/core';

/**
 * A mounted `@kujam/ui` element, as the wrappers expose it through `element`.
 *
 * @public
 */
export interface UiElementRef extends HTMLElement {
  board: CoreBoard | null;
}

/**
 * Item of a custom command palette source, the same shape as `CommandPaletteItem` in `@kujam/ui`.
 *
 * @public
 */
export interface UiCommandPaletteItem {
  readonly id: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly category?: string;
  readonly disabled?: boolean;
  run(board: CoreBoard): void;
}

/**
 * Custom item source of the command palette, the same shape as `CommandPaletteSource` in
 * `@kujam/ui`.
 *
 * @public
 */
export interface UiCommandPaletteSource {
  getItems(
    board: CoreBoard,
    query: string,
  ): readonly UiCommandPaletteItem[] | Promise<readonly UiCommandPaletteItem[]>;
}

/**
 * Props of the UI wrappers. Only {@link CommandPalette} reads `source`.
 *
 * @public
 */
export interface UiComponentProps {
  /** Board the element controls; `null` detaches it. */
  readonly board: CoreBoard | null;
  /** Custom item source of the command palette. */
  readonly source?: UiCommandPaletteSource;
}

/**
 * A Vue component wrapping one `@kujam/ui` element. Its public instance has `element`, the
 * mounted custom element, for methods such as `open()`.
 *
 * @public
 */
export type UiComponent = DefineComponent<UiComponentProps>;

const warned = new Set<string>();

function createUiComponent(
  tag: string,
  name: string,
  extra: readonly 'source'[] = [],
): UiComponent {
  return defineComponent({
    name,
    props: {
      board: { type: Object as PropType<CoreBoard | null>, default: null },
      source: { type: Object as PropType<UiCommandPaletteSource>, default: undefined },
    },
    setup(props, { expose }) {
      const element = ref<UiElementRef | null>(null);
      expose({
        get element() {
          return element.value;
        },
      });

      const assign = (): void => {
        const el = element.value;
        if (!el) return;
        for (const key of extra) (el as unknown as Record<string, unknown>)[key] = props[key];
        el.board = props.board ?? null;
      };

      onMounted(() => {
        const el = element.value;
        const registry = el?.ownerDocument.defaultView?.customElements;
        if (registry && !registry.get(tag) && !warned.has(tag)) {
          warned.add(tag);
          console.warn(
            `<${tag}> belum terdaftar. Panggil defineUiElements() dari @kujam/ui sekali sebelum ` +
              `memakai <${name}>.`,
          );
        }
        assign();
      });
      watch(() => [props.board, props.source], assign);
      // Detach on unmount so the element drops its board listeners even if it is kept alive.
      onBeforeUnmount(() => {
        if (element.value) element.value.board = null;
      });

      return () => h(tag, { ref: element });
    },
  }) as unknown as UiComponent;
}

/** Main toolbar (`<kujam-toolbar>`, BOARD-1402). @public */
export const Toolbar: UiComponent = createUiComponent('kujam-toolbar', 'KujamToolbar');
/** Zoom control (`<kujam-zoom-control>`, BOARD-1404). @public */
export const ZoomControl: UiComponent = createUiComponent('kujam-zoom-control', 'KujamZoomControl');
/** Undo and redo control (`<kujam-history-control>`, BOARD-1404). @public */
export const HistoryControl: UiComponent = createUiComponent(
  'kujam-history-control',
  'KujamHistoryControl',
);
/** Contextual selection toolbar (`<kujam-selection-toolbar>`, BOARD-1403). @public */
export const SelectionToolbar: UiComponent = createUiComponent(
  'kujam-selection-toolbar',
  'KujamSelectionToolbar',
);
/** Minimap (`<kujam-minimap>`, BOARD-1406). @public */
export const Minimap: UiComponent = createUiComponent('kujam-minimap', 'KujamMinimap');
/** Command palette (`<kujam-command-palette>`, BOARD-1405); reads `source`. @public */
export const CommandPalette: UiComponent = createUiComponent(
  'kujam-command-palette',
  'KujamCommandPalette',
  ['source'],
);
/** Context menu (`<kujam-context-menu>`, BOARD-1408). @public */
export const ContextMenu: UiComponent = createUiComponent('kujam-context-menu', 'KujamContextMenu');
/** Collaborators and connection status (`<kujam-presence-bar>`, BOARD-1407). @public */
export const PresenceBar: UiComponent = createUiComponent('kujam-presence-bar', 'KujamPresenceBar');
/** Shortcut help panel (`<kujam-shortcut-help>`, BOARD-1409). @public */
export const ShortcutHelp: UiComponent = createUiComponent(
  'kujam-shortcut-help',
  'KujamShortcutHelp',
);
