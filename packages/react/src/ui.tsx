/**
 * React wrappers for the `@kujam/ui` Web Components (BOARD-1410).
 *
 * Each wrapper renders the custom element by tag name and passes `board` (and element-specific
 * properties) as DOM properties. The adapter does not import `@kujam/ui` (BOARD-106: adapters only
 * depend on core and renderer), so the application registers the elements once with
 * `defineUiElements()` from `@kujam/ui`; until then the tag stays an unknown element and a
 * development warning is logged.
 */

import {
  createElement,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ForwardRefExoticComponent,
  type RefAttributes,
} from 'react';
import type { Board as CoreBoard } from '@kujam/core';

/**
 * A mounted `@kujam/ui` element, as the wrappers' `ref` exposes it. Element-specific methods,
 * such as `open()` on the command palette, are typed by the `@kujam/ui` element interfaces.
 *
 * @public
 */
export interface UiElementRef extends HTMLElement {
  board: CoreBoard | null;
}

/**
 * Props shared by every UI wrapper (BOARD-1410).
 *
 * @public
 */
export interface UiComponentProps {
  /** Board the element controls; `null` detaches it. */
  readonly board: CoreBoard | null;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly id?: string;
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
 * Props of {@link CommandPalette}.
 *
 * @public
 */
export interface CommandPaletteProps extends UiComponentProps {
  /** Custom item source. When omitted, the board's commands and tools are listed. */
  readonly source?: UiCommandPaletteSource;
}

/**
 * A React component wrapping one `@kujam/ui` element.
 *
 * @public
 */
export type UiComponent<P extends UiComponentProps = UiComponentProps> = ForwardRefExoticComponent<
  P & RefAttributes<UiElementRef>
>;

const warned = new Set<string>();

function createUiComponent<P extends UiComponentProps>(
  tag: string,
  displayName: string,
  extra: readonly Exclude<keyof P, keyof UiComponentProps>[] = [],
): UiComponent<P> {
  const component = forwardRef<UiElementRef, P>(function UiElement(props, ref) {
    const elementRef = useRef<UiElementRef | null>(null);
    useImperativeHandle(ref, () => elementRef.current as UiElementRef, []);

    useLayoutEffect(() => {
      const el = elementRef.current;
      if (!el) return;
      const registry = el.ownerDocument.defaultView?.customElements;
      if (registry && !registry.get(tag) && !warned.has(tag)) {
        warned.add(tag);
        console.warn(
          `<${tag}> belum terdaftar. Panggil defineUiElements() dari @kujam/ui sekali sebelum ` +
            `memakai <${displayName}>.`,
        );
      }
    }, []);

    useLayoutEffect(() => {
      const el = elementRef.current;
      if (!el) return;
      el.board = props.board;
    }, [props.board]);

    // Element-specific properties, such as the command palette `source`.
    const extraValues = extra.map((key) => (props as Record<string, unknown>)[key as string]);
    useLayoutEffect(() => {
      const el = elementRef.current as unknown as Record<string, unknown> | null;
      if (!el) return;
      extra.forEach((key, i) => {
        el[key as string] = extraValues[i];
      });
    }, extraValues);

    // Detach on unmount so the element drops its board listeners even if it is kept alive.
    useLayoutEffect(
      () => () => {
        if (elementRef.current) elementRef.current.board = null;
      },
      [],
    );

    return createElement(tag, {
      ref: elementRef,
      className: props.className,
      style: props.style,
      id: props.id,
    });
  });
  component.displayName = displayName;
  return component as UiComponent<P>;
}

/** Main toolbar (`<kujam-toolbar>`, BOARD-1402). @public */
export const Toolbar: UiComponent = createUiComponent('kujam-toolbar', 'Toolbar');
/** Zoom control (`<kujam-zoom-control>`, BOARD-1404). @public */
export const ZoomControl: UiComponent = createUiComponent('kujam-zoom-control', 'ZoomControl');
/** Undo and redo control (`<kujam-history-control>`, BOARD-1404). @public */
export const HistoryControl: UiComponent = createUiComponent(
  'kujam-history-control',
  'HistoryControl',
);
/** Contextual selection toolbar (`<kujam-selection-toolbar>`, BOARD-1403). @public */
export const SelectionToolbar: UiComponent = createUiComponent(
  'kujam-selection-toolbar',
  'SelectionToolbar',
);
/** Minimap (`<kujam-minimap>`, BOARD-1406). @public */
export const Minimap: UiComponent = createUiComponent('kujam-minimap', 'Minimap');
/** Command palette (`<kujam-command-palette>`, BOARD-1405). @public */
export const CommandPalette: UiComponent<CommandPaletteProps> =
  createUiComponent<CommandPaletteProps>('kujam-command-palette', 'CommandPalette', ['source']);
/** Context menu (`<kujam-context-menu>`, BOARD-1408). @public */
export const ContextMenu: UiComponent = createUiComponent('kujam-context-menu', 'ContextMenu');
/** Collaborators and connection status (`<kujam-presence-bar>`, BOARD-1407). @public */
export const PresenceBar: UiComponent = createUiComponent('kujam-presence-bar', 'PresenceBar');
/** Shortcut help panel (`<kujam-shortcut-help>`, BOARD-1409). @public */
export const ShortcutHelp: UiComponent = createUiComponent('kujam-shortcut-help', 'ShortcutHelp');
