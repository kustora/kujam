/**
 * Contextual selection toolbar `<kujam-selection-toolbar>` (BOARD-1403).
 *
 * Appears floating above the active selection, displaying:
 * - Style actions from `board.getActions()` (color, fill, stroke thickness, line style, font size, alignment, brush)
 * - Element commands: layer order, lock/unlock, duplicate, delete
 * - Automatically hidden during drag, transform, and camera zoom/pan, reappearing when finished
 * - Repositions to avoid viewport edges and never cover the selection
 */

import {
  COLOR_KEYS,
  STICKY_COLORS,
  type Board,
  type ElementAction,
  type ElementRecord,
} from '@kujam/core';
import { createElementClass, type UiWindow } from './base.js';
import { createIcon } from './icons.js';
import { t, tOr, type UiStringKey } from './i18n.js';
import {
  CONTROL_CSS,
  createMenu,
  labelButton,
  shortcutFor,
  type MenuEntry,
  type PopupMenu,
} from './controls.js';

const SELECTION_TOOLBAR_CSS = `
  :host {
    display: inline-block;
    position: absolute;
    z-index: 25;
    pointer-events: auto;
    transition: opacity var(--kujam-ui-motion), transform var(--kujam-ui-motion);
  }
  :host([hidden]) {
    display: none !important;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    border-radius: var(--kujam-ui-radius-lg);
    background: var(--kujam-ui-surface);
    border: 1px solid var(--kujam-ui-border);
    box-shadow: var(--kujam-ui-shadow-float);
  }
  .item {
    position: relative;
  }
  .btn {
    position: relative;
    display: grid;
    place-items: center;
    min-width: 32px;
    height: 32px;
    padding: 0 6px;
    border: 0;
    border-radius: var(--kujam-ui-radius-md);
    background: transparent;
    color: var(--kujam-ui-ink-muted);
    cursor: pointer;
    font-variant-numeric: tabular-nums;
    transition: background-color var(--kujam-ui-motion), color var(--kujam-ui-motion);
  }
  .btn:hover {
    background: var(--kujam-ui-surface-hover);
    color: var(--kujam-ui-ink);
  }
  .btn[aria-pressed='true'] {
    background: var(--kujam-ui-surface-inverse);
    color: var(--kujam-ui-on-inverse);
  }
  .btn:disabled {
    color: var(--kujam-ui-ink-disabled);
    background: transparent;
    cursor: default;
  }
  .swatch-btn {
    padding: 0 4px;
  }
  .swatch-icon {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--kujam-ui-border-strong);
  }
  .btn-label {
    font-weight: 600;
    font-size: 13px;
    text-transform: uppercase;
  }
  .fallback {
    font-weight: 600;
    font-size: 13px;
  }
  .sep {
    width: 1px;
    height: 18px;
    margin: 0 2px;
    background: var(--kujam-ui-border);
  }
  .caret {
    position: absolute;
    right: 2px;
    bottom: 2px;
    width: 0;
    height: 0;
    border-left: 3px solid transparent;
    border-bottom: 3px solid currentColor;
    opacity: 0.6;
  }
  ${CONTROL_CSS}
  :host([data-placement='below']) .menu {
    top: calc(100% + 6px);
    bottom: auto;
  }
  :host([data-placement='above']) .menu {
    bottom: calc(100% + 6px);
    top: auto;
  }
`;

interface RenderedControl {
  readonly id: string;
  readonly button: HTMLButtonElement;
  readonly menu: PopupMenu | null;
}

/**
 * Creates the `<kujam-selection-toolbar>` element class for a window (BOARD-1403).
 *
 * @internal
 */
export function createSelectionToolbarClass(win: UiWindow) {
  return createElementClass(win, {
    css: SELECTION_TOOLBAR_CSS,
    render(root, board, host) {
      const doc = host.ownerDocument;
      host.setAttribute('role', 'toolbar');
      host.setAttribute('aria-label', t('selectionToolbar', board.locale));
      host.hidden = true;

      const bar = doc.createElement('div');
      bar.className = 'bar';
      root.append(bar);

      let rendered: RenderedControl[] = [];
      let isDragging = false;
      let cameraTimer: ReturnType<typeof setTimeout> | null = null;

      function iconOrLetter(icon: string | undefined, label: string, size = 18): Node {
        const el = createIcon(doc, icon, size);
        if (el) return el;
        const fallback = doc.createElement('span');
        fallback.className = 'fallback';
        fallback.textContent = label.trim().charAt(0).toUpperCase();
        return fallback;
      }

      function openMenu(): PopupMenu | undefined {
        return rendered.find((r) => r.menu?.isOpen)?.menu ?? undefined;
      }

      function closeMenus(): void {
        for (const r of rendered) r.menu?.close();
      }

      function selectedElements(): Readonly<ElementRecord>[] {
        const out: Readonly<ElementRecord>[] = [];
        for (const id of board.selection) {
          const el = board.getElement(id);
          if (el) out.push(el);
        }
        return out;
      }

      function resolveColor(key: string): string | undefined {
        const sticky = (board.theme.sticky as Record<string, string> | undefined)?.[key];
        if (sticky) return sticky;
        const color = (board.theme.colors as Record<string, string> | undefined)?.[key];
        if (color) return color;
        return key;
      }

      function reposition(): void {
        if (board.selection.length === 0) {
          host.hidden = true;
          return;
        }

        const bounds = board.selectionBounds;
        if (!bounds) {
          host.hidden = true;
          return;
        }

        const tl = board.camera.boardToScreen({ x: bounds.minX, y: bounds.minY });
        const br = board.camera.boardToScreen({ x: bounds.maxX, y: bounds.maxY });
        const screenMinX = Math.min(tl.x, br.x);
        const screenMaxX = Math.max(tl.x, br.x);
        const screenMinY = Math.min(tl.y, br.y);
        const screenMaxY = Math.max(tl.y, br.y);
        const centerX = (screenMinX + screenMaxX) / 2;

        const container = host.parentElement;
        const containerWidth = container?.clientWidth || 1200;
        const containerHeight = container?.clientHeight || 800;

        const GAP = 10;
        const toolbarHeight = host.offsetHeight || 42;
        const halfWidth = (host.offsetWidth || 260) / 2;

        let top = screenMinY - GAP - toolbarHeight;
        let placement: 'above' | 'below' = 'above';

        // Flip to below if too close to the top edge
        if (top < 10) {
          top = screenMaxY + GAP;
          placement = 'below';
          // If placing below exceeds container space (near bottom toolbar), clamp inside viewport
          if (top > containerHeight - toolbarHeight - 75) {
            top = Math.max(10, screenMinY - GAP - toolbarHeight);
            placement = 'above';
          }
        }

        const left = Math.max(halfWidth + 10, Math.min(containerWidth - halfWidth - 10, centerX));
        host.style.left = `${left}px`;
        host.style.top = `${top}px`;
        host.style.transform = 'translateX(-50%)';
        host.dataset.placement = placement;
        host.hidden = false;
      }

      function rebuild(): void {
        closeMenus();
        bar.replaceChildren();
        rendered = [];

        if (board.selection.length === 0) {
          host.hidden = true;
          return;
        }

        const actions = board.getActions();
        const selected = selectedElements();
        if (selected.length === 0) {
          host.hidden = true;
          return;
        }

        // Group actions by group ID
        const groups = new Map<string, ElementAction[]>();
        for (const action of actions) {
          const groupKey = action.group ?? 'other';
          const list = groups.get(groupKey) ?? [];
          list.push(action);
          groups.set(groupKey, list);
        }

        const createControlWrap = (id: string): { wrap: HTMLElement; button: HTMLButtonElement } => {
          const wrap = doc.createElement('div');
          wrap.className = 'item';
          const button = doc.createElement('button');
          button.type = 'button';
          button.className = 'btn';
          button.tabIndex = -1;
          button.dataset.action = id;
          wrap.append(button);
          bar.append(wrap);
          return { wrap, button };
        };

        // 1. Style Controls from board.getActions()
        for (const [groupKey, groupActions] of groups.entries()) {
          if (groupActions.length === 0) continue;

          // Color groups: style.color or style.fillColor
          if (groupKey === 'style.color' || groupKey === 'style.fillColor') {
            const isFill = groupKey === 'style.fillColor';
            const groupLabelKey: UiStringKey = isFill ? 'style.fillColor' : 'style.color';
            const groupLabel = t(groupLabelKey, board.locale);

            const { wrap, button } = createControlWrap(groupKey);
            button.classList.add('swatch-btn');
            const activeAction = groupActions.find((a) => a.isActive?.());
            const activeKey = activeAction ? activeAction.id.split('.').pop()! : 'black';
            const activeColor = resolveColor(activeKey) ?? '#17191E';

            const swatchEl = doc.createElement('span');
            swatchEl.className = 'swatch-icon';
            swatchEl.style.backgroundColor = activeColor;
            button.append(swatchEl);

            const caret = doc.createElement('span');
            caret.className = 'caret';
            button.append(caret);

            labelButton(button, groupLabel, undefined);

            const isStickyGroup = groupActions.some((a) => STICKY_COLORS.includes(a.id.split('.').pop() as any));
            const popup = createMenu(doc, {
              id: `kujam-selection-${groupKey}`,
              label: groupLabel,
              anchor: button,
              wrap,
              radio: true,
            });

            const entries: MenuEntry[] = groupActions.map((action) => {
              const key = action.id.split('.').pop()!;
              const color = resolveColor(key);
              const label = tOr(`color.${key}`, board.locale, key);
              return {
                id: action.id,
                label,
                swatch: color,
                checked: action.isActive?.(),
                disabled: action.isEnabled ? !action.isEnabled() : false,
                select: () => {
                  action.run();
                },
              };
            });

            popup.setEntries(entries);

            button.addEventListener('click', () => {
              if (popup.isOpen) popup.close();
              else {
                closeMenus();
                popup.open();
              }
            });

            rendered.push({ id: groupKey, button, menu: popup });
            continue;
          }

          // Alignment group: style.align
          if (groupKey === 'style.align') {
            const groupLabel = t('style.align', board.locale);
            const { wrap, button } = createControlWrap(groupKey);
            const activeAction = groupActions.find((a) => a.isActive?.());
            const alignKey = activeAction ? activeAction.id.split('.').pop()! : 'start';
            const iconName = alignKey === 'center' ? 'alignCenter' : alignKey === 'end' ? 'alignRight' : 'alignLeft';

            button.append(iconOrLetter(iconName, alignKey, 18));
            const caret = doc.createElement('span');
            caret.className = 'caret';
            button.append(caret);
            labelButton(button, groupLabel, undefined);

            const popup = createMenu(doc, {
              id: `kujam-selection-align`,
              label: groupLabel,
              anchor: button,
              wrap,
              radio: true,
            });

            const entries: MenuEntry[] = groupActions.map((action) => {
              const key = action.id.split('.').pop()!;
              const icon = key === 'center' ? 'alignCenter' : key === 'end' ? 'alignRight' : 'alignLeft';
              const labelKey: UiStringKey = key === 'center' ? 'style.align.center' : key === 'end' ? 'style.align.end' : 'style.align.start';
              return {
                id: action.id,
                label: t(labelKey, board.locale),
                icon: iconOrLetter(icon, key, 16),
                checked: action.isActive?.(),
                disabled: action.isEnabled ? !action.isEnabled() : false,
                select: () => action.run(),
              };
            });
            popup.setEntries(entries);

            button.addEventListener('click', () => {
              if (popup.isOpen) popup.close();
              else {
                closeMenus();
                popup.open();
              }
            });

            rendered.push({ id: groupKey, button, menu: popup });
            continue;
          }

          // Line dash group: style.dash
          if (groupKey === 'style.dash') {
            const groupLabel = t('style.dash', board.locale);
            const { wrap, button } = createControlWrap(groupKey);
            const activeAction = groupActions.find((a) => a.isActive?.());
            const dashKey = activeAction ? activeAction.id.split('.').pop()! : 'solid';
            const iconName = dashKey === 'dashed' ? 'dashDashed' : dashKey === 'dotted' ? 'dashDotted' : 'dashSolid';

            button.append(iconOrLetter(iconName, dashKey, 18));
            const caret = doc.createElement('span');
            caret.className = 'caret';
            button.append(caret);
            labelButton(button, groupLabel, undefined);

            const popup = createMenu(doc, {
              id: `kujam-selection-dash`,
              label: groupLabel,
              anchor: button,
              wrap,
              radio: true,
            });

            const entries: MenuEntry[] = groupActions.map((action) => {
              const key = action.id.split('.').pop()!;
              const icon = key === 'dashed' ? 'dashDashed' : key === 'dotted' ? 'dashDotted' : 'dashSolid';
              const labelKey: UiStringKey = key === 'dashed' ? 'style.dash.dashed' : key === 'dotted' ? 'style.dash.dotted' : 'style.dash.solid';
              return {
                id: action.id,
                label: t(labelKey, board.locale),
                icon: iconOrLetter(icon, key, 16),
                checked: action.isActive?.(),
                disabled: action.isEnabled ? !action.isEnabled() : false,
                select: () => action.run(),
              };
            });
            popup.setEntries(entries);

            button.addEventListener('click', () => {
              if (popup.isOpen) popup.close();
              else {
                closeMenus();
                popup.open();
              }
            });

            rendered.push({ id: groupKey, button, menu: popup });
            continue;
          }

          // Thickness group: style.thickness
          if (groupKey === 'style.thickness') {
            const groupLabel = t('style.thickness', board.locale);
            const { wrap, button } = createControlWrap(groupKey);
            const activeAction = groupActions.find((a) => a.isActive?.());
            const thicknessKey = activeAction ? activeAction.id.split('.').pop()! : 'm';

            const labelEl = doc.createElement('span');
            labelEl.className = 'btn-label';
            labelEl.textContent = thicknessKey.toUpperCase();
            button.append(labelEl);

            const caret = doc.createElement('span');
            caret.className = 'caret';
            button.append(caret);
            labelButton(button, groupLabel, undefined);

            const popup = createMenu(doc, {
              id: `kujam-selection-thickness`,
              label: groupLabel,
              anchor: button,
              wrap,
              radio: true,
            });

            const entries: MenuEntry[] = groupActions.map((action) => {
              const key = action.id.split('.').pop()!;
              const labelKey: UiStringKey = key === 's' ? 'size.s' : key === 'm' ? 'size.m' : key === 'l' ? 'size.l' : 'size.xl';
              return {
                id: action.id,
                label: t(labelKey, board.locale),
                checked: action.isActive?.(),
                disabled: action.isEnabled ? !action.isEnabled() : false,
                select: () => action.run(),
              };
            });
            popup.setEntries(entries);

            button.addEventListener('click', () => {
              if (popup.isOpen) popup.close();
              else {
                closeMenus();
                popup.open();
              }
            });

            rendered.push({ id: groupKey, button, menu: popup });
            continue;
          }

          // Font size group: style.size
          if (groupKey === 'style.size') {
            const groupLabel = t('style.size', board.locale);
            const { wrap, button } = createControlWrap(groupKey);
            const activeAction = groupActions.find((a) => a.isActive?.());
            const sizeKey = activeAction ? activeAction.id.split('.').pop()! : 'm';

            const labelEl = doc.createElement('span');
            labelEl.className = 'btn-label';
            labelEl.textContent = sizeKey.toUpperCase();
            button.append(labelEl);

            const caret = doc.createElement('span');
            caret.className = 'caret';
            button.append(caret);
            labelButton(button, groupLabel, undefined);

            const popup = createMenu(doc, {
              id: `kujam-selection-size`,
              label: groupLabel,
              anchor: button,
              wrap,
              radio: true,
            });

            const entries: MenuEntry[] = groupActions.map((action) => {
              const key = action.id.split('.').pop()!;
              const labelKey: UiStringKey = key === 's' ? 'size.s' : key === 'm' ? 'size.m' : key === 'l' ? 'size.l' : 'size.xl';
              return {
                id: action.id,
                label: t(labelKey, board.locale),
                checked: action.isActive?.(),
                disabled: action.isEnabled ? !action.isEnabled() : false,
                select: () => action.run(),
              };
            });
            popup.setEntries(entries);

            button.addEventListener('click', () => {
              if (popup.isOpen) popup.close();
              else {
                closeMenus();
                popup.open();
              }
            });

            rendered.push({ id: groupKey, button, menu: popup });
            continue;
          }

          // Fill style: style.fill
          if (groupKey === 'style.fill') {
            const groupLabel = t('style.fill', board.locale);
            const { wrap, button } = createControlWrap(groupKey);
            const activeAction = groupActions.find((a) => a.isActive?.());
            const fillKey = activeAction ? activeAction.id.split('.').pop()! : 'solid';
            const fillLabelKey: UiStringKey = fillKey === 'none' ? 'style.fill.none' : fillKey === 'semi' ? 'style.fill.semi' : 'style.fill.solid';

            const labelEl = doc.createElement('span');
            labelEl.className = 'btn-label';
            labelEl.textContent = t(fillLabelKey, board.locale);
            button.append(labelEl);

            const caret = doc.createElement('span');
            caret.className = 'caret';
            button.append(caret);
            labelButton(button, groupLabel, undefined);

            const popup = createMenu(doc, {
              id: `kujam-selection-fill`,
              label: groupLabel,
              anchor: button,
              wrap,
              radio: true,
            });

            const entries: MenuEntry[] = groupActions.map((action) => {
              const key = action.id.split('.').pop()!;
              const labelKey: UiStringKey = key === 'none' ? 'style.fill.none' : key === 'semi' ? 'style.fill.semi' : 'style.fill.solid';
              return {
                id: action.id,
                label: t(labelKey, board.locale),
                checked: action.isActive?.(),
                disabled: action.isEnabled ? !action.isEnabled() : false,
                select: () => action.run(),
              };
            });
            popup.setEntries(entries);

            button.addEventListener('click', () => {
              if (popup.isOpen) popup.close();
              else {
                closeMenus();
                popup.open();
              }
            });

            rendered.push({ id: groupKey, button, menu: popup });
            continue;
          }

          // Generic style or element action group
          if (groupActions.length > 1) {
            const groupLabel = groupActions[0]?.label.split(':')[0] ?? groupKey;
            const { wrap, button } = createControlWrap(groupKey);
            button.append(iconOrLetter('chevron', groupLabel, 16));
            labelButton(button, groupLabel, undefined);

            const popup = createMenu(doc, {
              id: `kujam-selection-${groupKey}`,
              label: groupLabel,
              anchor: button,
              wrap,
              radio: true,
            });

            const entries: MenuEntry[] = groupActions.map((action) => ({
              id: action.id,
              label: action.label,
              checked: action.isActive?.(),
              disabled: action.isEnabled ? !action.isEnabled() : false,
              select: () => action.run(),
            }));
            popup.setEntries(entries);

            button.addEventListener('click', () => {
              if (popup.isOpen) popup.close();
              else {
                closeMenus();
                popup.open();
              }
            });

            rendered.push({ id: groupKey, button, menu: popup });
          } else {
            const single = groupActions[0]!;
            const { button } = createControlWrap(single.id);
            if (single.icon) button.append(iconOrLetter(single.icon, single.label, 18));
            else {
              const text = doc.createElement('span');
              text.textContent = single.label;
              button.append(text);
            }
            labelButton(button, single.label, undefined);
            button.addEventListener('click', () => single.run());
            rendered.push({ id: single.id, button, menu: null });
          }
        }

        // Add separator before standard element actions
        const sep = doc.createElement('div');
        sep.className = 'sep';
        sep.setAttribute('role', 'separator');
        sep.setAttribute('aria-orientation', 'vertical');
        bar.append(sep);

        // 2. Layer Order Menu (BOARD-1403)
        const layerWrap = doc.createElement('div');
        layerWrap.className = 'item';
        const layerBtn = doc.createElement('button');
        layerBtn.type = 'button';
        layerBtn.className = 'btn';
        layerBtn.tabIndex = -1;
        layerBtn.append(iconOrLetter('layer', 'layer', 18));
        const layerCaret = doc.createElement('span');
        layerCaret.className = 'caret';
        layerBtn.append(layerCaret);
        labelButton(layerBtn, t('layer', board.locale), undefined);
        layerWrap.append(layerBtn);
        bar.append(layerWrap);

        const layerMenu = createMenu(doc, {
          id: 'kujam-selection-layer',
          label: t('layer', board.locale),
          anchor: layerBtn,
          wrap: layerWrap,
          radio: false,
        });

        const layerEntries: MenuEntry[] = [
          {
            id: 'layer.bring-to-front',
            label: t('layer.bringToFront', board.locale),
            shortcut: shortcutFor(board, 'layer.bring-to-front'),
            select: () => void board.run('layer.bring-to-front'),
          },
          {
            id: 'layer.bring-forward',
            label: t('layer.bringForward', board.locale),
            shortcut: shortcutFor(board, 'layer.bring-forward'),
            select: () => void board.run('layer.bring-forward'),
          },
          {
            id: 'layer.send-backward',
            label: t('layer.sendBackward', board.locale),
            shortcut: shortcutFor(board, 'layer.send-backward'),
            select: () => void board.run('layer.send-backward'),
          },
          {
            id: 'layer.send-to-back',
            label: t('layer.sendToBack', board.locale),
            shortcut: shortcutFor(board, 'layer.send-to-back'),
            select: () => void board.run('layer.send-to-back'),
          },
        ];
        layerMenu.setEntries(layerEntries);
        layerBtn.addEventListener('click', () => {
          if (layerMenu.isOpen) layerMenu.close();
          else {
            closeMenus();
            layerMenu.open();
          }
        });
        rendered.push({ id: 'layer', button: layerBtn, menu: layerMenu });

        // 3. Lock / Unlock Button (BOARD-1403)
        const anyLocked = selected.some((el) => el.locked);
        const { button: lockBtn } = createControlWrap('lock');
        lockBtn.append(iconOrLetter(anyLocked ? 'unlock' : 'lock', anyLocked ? 'unlock' : 'lock', 18));
        const lockLabelKey: UiStringKey = anyLocked ? 'unlock' : 'lock';
        labelButton(lockBtn, t(lockLabelKey, board.locale), shortcutFor(board, anyLocked ? 'element.unlock' : 'element.lock'));
        lockBtn.disabled = board.readOnly;
        lockBtn.addEventListener('click', () => {
          if (anyLocked) void board.run('element.unlock');
          else void board.run('element.lock');
        });
        rendered.push({ id: 'lock', button: lockBtn, menu: null });

        // 4. Duplicate Button
        const { button: dupBtn } = createControlWrap('duplicate');
        dupBtn.append(iconOrLetter('duplicate', 'duplicate', 18));
        labelButton(dupBtn, t('duplicate', board.locale), shortcutFor(board, 'element.duplicate'));
        dupBtn.disabled = board.readOnly || selected.every((el) => el.locked);
        dupBtn.addEventListener('click', () => {
          void board.run('element.duplicate');
        });
        rendered.push({ id: 'duplicate', button: dupBtn, menu: null });

        // 5. Delete Button (BOARD-1403)
        const { button: delBtn } = createControlWrap('delete');
        delBtn.append(iconOrLetter('trash', 'delete', 18));
        labelButton(delBtn, t('delete', board.locale), shortcutFor(board, 'element.delete'));
        delBtn.disabled = board.readOnly || selected.every((el) => el.locked);
        delBtn.addEventListener('click', () => {
          void board.run('element.delete');
        });
        rendered.push({ id: 'delete', button: delBtn, menu: null });

        // Roving tabindex on bar
        const buttons = rendered.map((r) => r.button).filter((b) => !b.disabled);
        if (buttons[0]) buttons[0].tabIndex = 0;

        bar.onkeydown = (e: KeyboardEvent) => {
          const list = rendered.map((r) => r.button).filter((b) => !b.disabled);
          const idx = list.indexOf(e.target as HTMLButtonElement);
          if (idx === -1) return;
          let next = -1;
          if (e.key === 'ArrowRight') next = (idx + 1) % list.length;
          else if (e.key === 'ArrowLeft') next = (idx - 1 + list.length) % list.length;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = list.length - 1;
          else if (e.key === 'Escape') {
            if (openMenu()) {
              closeMenus();
            } else {
              board.clearSelection();
            }
            return;
          }
          if (next >= 0 && list[next]) {
            e.preventDefault();
            list[idx]!.tabIndex = -1;
            list[next]!.tabIndex = 0;
            list[next]!.focus();
          }
        };

        reposition();
      }

      // Hide toolbar when dragging starts on the board (outside host)
      const onPointerDown = (e: PointerEvent): void => {
        if (e.composedPath().includes(host)) return;
        closeMenus();
        isDragging = true;
        host.style.opacity = '0';
        host.style.pointerEvents = 'none';
      };

      const onPointerUp = (): void => {
        if (!isDragging) return;
        isDragging = false;
        host.style.opacity = '1';
        host.style.pointerEvents = 'auto';
        reposition();
      };

      const onCamera = (): void => {
        closeMenus();
        host.style.opacity = '0';
        host.style.pointerEvents = 'none';
        if (cameraTimer) clearTimeout(cameraTimer);
        cameraTimer = setTimeout(() => {
          if (!isDragging) {
            host.style.opacity = '1';
            host.style.pointerEvents = 'auto';
            reposition();
          }
        }, 120);
      };

      doc.addEventListener('pointerdown', onPointerDown, true);
      doc.addEventListener('pointerup', onPointerUp, true);
      doc.addEventListener('pointercancel', onPointerUp, true);

      rebuild();

      const offs = [
        board.on('selection', rebuild),
        board.on('change', rebuild),
        board.on('tool-style', rebuild),
        board.on('theme', rebuild),
        board.on('camera', onCamera),
      ];

      return () => {
        if (cameraTimer) clearTimeout(cameraTimer);
        doc.removeEventListener('pointerdown', onPointerDown, true);
        doc.removeEventListener('pointerup', onPointerUp, true);
        doc.removeEventListener('pointercancel', onPointerUp, true);
        for (const off of offs) off();
      };
    },
  });
}
