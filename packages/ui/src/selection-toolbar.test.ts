// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  defineElement,
  definePlugin,
  defineTool,
  object,
  rect,
  schema,
  string,
  type ActionEvent,
  type Board,
  type BoardErrorEvent,
  type BoardOptions,
} from '@kujam/core';
import { defineUiElements, UI_TAGS, type KujamUiElement } from './index.js';

const selectTool = defineTool({ id: 'select', initial: 'idle', states: { idle: {} } });
const testTools = definePlugin({
  id: 'test-tools',
  tools: [selectTool],
});

let boards: Board[] = [];

afterEach(() => {
  for (const board of boards) {
    if (!board.disposed) board.dispose();
  }
  boards = [];
  document.body.innerHTML = '';
});

function createTestBoard(options: BoardOptions = {}): Board {
  const board = createBoard({ plugins: [testTools], ...options });
  board.setTool('select');
  boards.push(board);
  return board;
}

function mountSelectionToolbar(board: Board): KujamUiElement {
  defineUiElements();
  const el = document.createElement(UI_TAGS.selection) as KujamUiElement;
  el.board = board;
  document.body.append(el);
  return el;
}

describe('BOARD-1205: Contextual Selection Toolbar for Custom Elements', () => {
  it('renders multi-action groups with dropdown menu, icons, labels, enabled and active states', () => {
    const customPlugin = definePlugin({
      id: 'contact-plugin',
      elements: [
        defineElement({
          type: 'contact-card',
          version: 1,
          props: schema({ contactId: string(), status: string() }),
          defaults: { contactId: 'c-1', status: 'active' },
          geometry: (el) => rect(el.w, el.h),
          actions: (el, _data, ctx) => [
            {
              id: 'contact.call',
              label: 'Panggil Kontak',
              icon: 'select',
              group: 'contact',
              isActive: () => el.props.status === 'active',
              run: () => ctx.emit('contact:call', { contactId: el.props.contactId }),
            },
            {
              id: 'contact.email',
              label: 'Kirim Email',
              group: 'contact',
              isEnabled: () => false, // disabled action
              run: () => ctx.emit('contact:email', { contactId: el.props.contactId }),
            },
          ],
        }),
      ],
    });

    const board = createTestBoard({ plugins: [testTools, customPlugin] });
    const rec = board.create({
      type: 'contact-card',
      x: 100,
      y: 100,
      w: 200,
      h: 100,
      props: { contactId: 'c-1', status: 'active' },
    })!;

    board.select(rec.id);
    const el = mountSelectionToolbar(board);

    // Multi-action group trigger button
    const triggerBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="contact"]')!;
    expect(triggerBtn).not.toBeNull();
    expect(triggerBtn.getAttribute('aria-label')).toBe('contact');
    expect(triggerBtn.querySelector('.caret')).not.toBeNull();
    // Active state reflected on trigger button
    expect(triggerBtn.getAttribute('aria-pressed')).toBe('true');

    // Popup menu
    const menu = el.shadowRoot!.querySelector<HTMLElement>('#kujam-selection-contact')!;
    expect(menu).not.toBeNull();
    expect(menu.hidden).toBe(true);

    triggerBtn.click();
    expect(menu.hidden).toBe(false);

    // Check entry items inside the popup menu
    const callOption = menu.querySelector<HTMLButtonElement>('[data-id="contact.call"]')!;
    expect(callOption).not.toBeNull();
    expect(callOption.disabled).toBe(false);
    expect(callOption.getAttribute('aria-checked')).toBe('true');
    expect(callOption.textContent).toContain('Panggil Kontak');
    expect(callOption.querySelector('svg')).not.toBeNull(); // has icon

    const emailOption = menu.querySelector<HTMLButtonElement>('[data-id="contact.email"]')!;
    expect(emailOption).not.toBeNull();
    expect(emailOption.disabled).toBe(true); // disabled state
    expect(emailOption.textContent).toContain('Kirim Email');
  });

  it('clicking a multi-action group item calls board.runAction and emits action event on board', () => {
    const emitted: ActionEvent[] = [];
    const customPlugin = definePlugin({
      id: 'contact-plugin',
      elements: [
        defineElement({
          type: 'contact-card',
          version: 1,
          props: schema({ contactId: string() }),
          defaults: { contactId: 'c-2' },
          geometry: (el) => rect(el.w, el.h),
          actions: (el, _data, ctx) => [
            {
              id: 'contact.call',
              label: 'Hubungi',
              group: 'contact',
              run: () => ctx.emit('contact:call', { contactId: el.props.contactId }),
            },
            {
              id: 'contact.chat',
              label: 'Kirim Pesan',
              group: 'contact',
              run: () => ctx.emit('contact:chat', { contactId: el.props.contactId }),
            },
          ],
        }),
      ],
    });

    const board = createTestBoard({ plugins: [testTools, customPlugin] });
    board.on('action', (ev) => emitted.push(ev));

    const runActionSpy = vi.spyOn(board, 'runAction');

    const rec = board.create({
      type: 'contact-card',
      x: 100,
      y: 100,
      w: 150,
      h: 80,
      props: { contactId: 'c-2' },
    })!;

    board.select(rec.id);
    const el = mountSelectionToolbar(board);

    const triggerBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="contact"]')!;
    triggerBtn.click();

    const menu = el.shadowRoot!.querySelector<HTMLElement>('#kujam-selection-contact')!;
    const callOpt = menu.querySelector<HTMLButtonElement>('[data-id="contact.call"]')!;
    callOpt.click();

    // Verify board.runAction was executed with the action and element
    expect(runActionSpy).toHaveBeenCalledTimes(1);
    expect(runActionSpy.mock.calls[0]![0].id).toBe('contact.call');
    expect(runActionSpy.mock.calls[0]![1].id).toBe(rec.id);

    // Verify action event was emitted on board
    expect(emitted).toEqual([{ name: 'contact:call', payload: { contactId: 'c-2' } }]);
  });

  it('renders single custom actions as standalone buttons with label, icon, enabled, and active state', () => {
    const emitted: ActionEvent[] = [];
    const customPlugin = definePlugin({
      id: 'single-action-plugin',
      elements: [
        defineElement({
          type: 'custom-widget',
          version: 1,
          props: schema({ starred: string() }),
          defaults: { starred: 'true' },
          geometry: (el) => rect(el.w, el.h),
          actions: (el, _data, ctx) => [
            {
              id: 'widget.star',
              label: 'Bintang',
              icon: 'select',
              isActive: () => el.props.starred === 'true',
              run: () => ctx.emit('widget:star', { id: el.id }),
            },
            {
              id: 'widget.reset',
              label: 'Reset',
              isEnabled: () => false,
              run: () => ctx.emit('widget:reset', { id: el.id }),
            },
          ],
        }),
      ],
    });

    const board = createTestBoard({ plugins: [testTools, customPlugin] });
    board.on('action', (ev) => emitted.push(ev));

    const rec = board.create({
      type: 'custom-widget',
      x: 200,
      y: 200,
      w: 100,
      h: 100,
      props: { starred: 'true' },
    })!;

    board.select(rec.id);
    const el = mountSelectionToolbar(board);

    // Both actions are standalone buttons because they have no group
    const starBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="widget.star"]')!;
    expect(starBtn).not.toBeNull();
    expect(starBtn.querySelector('svg')).not.toBeNull(); // has icon
    expect(starBtn.querySelector('.caret')).toBeNull(); // not a dropdown
    expect(starBtn.getAttribute('aria-pressed')).toBe('true'); // active state
    expect(starBtn.disabled).toBe(false);

    const resetBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="widget.reset"]')!;
    expect(resetBtn).not.toBeNull();
    expect(resetBtn.querySelector('.btn-text')?.textContent).toBe('Reset');
    expect(resetBtn.disabled).toBe(true); // disabled state

    // Clicking starBtn runs action and emits event
    starBtn.click();
    expect(emitted).toEqual([{ name: 'widget:star', payload: { id: rec.id } }]);
  });

  it('updates custom element actions when element data resolves via board data event', () => {
    let contactData: { name: string } | undefined = undefined;

    const customPlugin = definePlugin({
      id: 'async-card-plugin',
      elements: [
        defineElement({
          type: 'async-card',
          version: 1,
          props: schema({ id: string() }),
          defaults: { id: 'ac-1' },
          geometry: (el) => rect(el.w, el.h),
          resolve: () => contactData,
          actions: (el, data, ctx) => [
            {
              id: 'card.view',
              label: data ? `Lihat ${data.name}` : 'Lihat Kontak',
              isEnabled: () => data !== undefined,
              run: () => ctx.emit('card:view', { name: data?.name }),
            },
          ],
        }),
      ],
    });

    const board = createTestBoard({ plugins: [testTools, customPlugin] });
    const rec = board.create({
      type: 'async-card',
      x: 100,
      y: 100,
      w: 120,
      h: 60,
      props: { id: 'ac-1' },
    })!;

    board.select(rec.id);
    const el = mountSelectionToolbar(board);

    // Initial state: data is not loaded yet
    let viewBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="card.view"]')!;
    expect(viewBtn).not.toBeNull();
    expect(viewBtn.textContent).toContain('Lihat Kontak');
    expect(viewBtn.disabled).toBe(true);

    // External data resolves
    contactData = { name: 'Siti' };
    board.reloadElementData(rec.id);

    // Toolbar updates automatically on data event
    viewBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="card.view"]')!;
    expect(viewBtn.textContent).toContain('Lihat Siti');
    expect(viewBtn.disabled).toBe(false);
  });

  it('enforces permission hooks before executing actions and emits forbidden error on denial', () => {
    let allowAction = false;
    const errors: BoardErrorEvent[] = [];

    const customPlugin = definePlugin({
      id: 'permission-plugin',
      elements: [
        defineElement({
          type: 'secure-card',
          version: 1,
          props: schema({ id: string() }),
          defaults: { id: 'sec-1' },
          geometry: (el) => rect(el.w, el.h),
          actions: (el, _data, ctx) => [
            {
              id: 'secure.execute',
              label: 'Aksi Rahasia',
              run: () => ctx.emit('secret:run', { id: el.id }),
            },
          ],
        }),
      ],
    });

    const board = createTestBoard({
      plugins: [testTools, customPlugin],
      permissions: (action) => {
        if (action === 'action') return allowAction;
        return true;
      },
    });

    board.on('error', (err) => errors.push(err));

    const rec = board.create({
      type: 'secure-card',
      x: 100,
      y: 100,
      w: 100,
      h: 100,
      props: { id: 'sec-1' },
    })!;

    board.select(rec.id);
    const el = mountSelectionToolbar(board);

    const btn = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="secure.execute"]')!;
    // When permission is denied, toolbar button is disabled
    expect(btn.disabled).toBe(true);

    // Directly invoking board.runAction when denied emits forbidden error
    const [action] = board.getActions(rec.id);
    expect(action).toBeDefined();
    const success = board.runAction(action!, rec);
    expect(success).toBe(false);
    expect(errors.length).toBe(1);
    expect(errors[0]!.code).toBe('forbidden');

    // When permission is allowed, update triggers rebuild with enabled button
    allowAction = true;
    board.update(rec.id, { props: { id: 'sec-2' } });

    const updatedBtn = el.shadowRoot!.querySelector<HTMLButtonElement>(
      '[data-action="secure.execute"]',
    )!;
    expect(updatedBtn.disabled).toBe(false);
    const emitted: ActionEvent[] = [];
    board.on('action', (ev) => emitted.push(ev));

    updatedBtn.click();
    expect(emitted).toEqual([{ name: 'secret:run', payload: { id: rec.id } }]);
  });

  it('displays custom element actions alongside style controls and standard commands', () => {
    const customPlugin = definePlugin({
      id: 'full-card-plugin',
      elements: [
        defineElement({
          type: 'full-card',
          version: 1,
          props: schema({ color: string(), contactId: string() }),
          defaults: { color: 'yellow', contactId: 'c-full' },
          geometry: (el) => rect(el.w, el.h),
          actions: (el, _data, ctx) => [
            {
              id: 'style.color.yellow',
              label: 'Warna: Kuning',
              group: 'style.color',
              isActive: () => el.props.color === 'yellow',
              run: () => ctx.updateProps({ color: 'yellow' }),
            },
            {
              id: 'style.color.blue',
              label: 'Warna: Biru',
              group: 'style.color',
              isActive: () => el.props.color === 'blue',
              run: () => ctx.updateProps({ color: 'blue' }),
            },
            {
              id: 'contact.call',
              label: 'Panggil',
              group: 'contact',
              run: () => ctx.emit('contact:call', { contactId: el.props.contactId }),
            },
            {
              id: 'contact.email',
              label: 'Email',
              group: 'contact',
              run: () => ctx.emit('contact:email', { contactId: el.props.contactId }),
            },
          ],
        }),
      ],
    });

    const board = createTestBoard({ plugins: [testTools, customPlugin] });
    const rec = board.create({
      type: 'full-card',
      x: 100,
      y: 100,
      w: 180,
      h: 90,
      props: { color: 'yellow', contactId: 'c-full' },
    })!;

    board.select(rec.id);
    const el = mountSelectionToolbar(board);

    // 1. Common style action group
    const colorBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="style.color"]');
    expect(colorBtn).not.toBeNull();

    // 2. Custom element action group
    const contactBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('[data-action="contact"]');
    expect(contactBtn).not.toBeNull();

    // 3. Separator
    const sep = el.shadowRoot!.querySelector('.sep');
    expect(sep).not.toBeNull();

    // 4. Standard commands
    expect(el.shadowRoot!.querySelector('[data-action="layer"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-action="lock"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-action="duplicate"]')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('[data-action="delete"]')).not.toBeNull();
  });

  it('verifies toolbar avoids viewport edges, flips below when near top edge, and clamps horizontally', () => {
    const customPlugin = definePlugin({
      id: 'box-plugin',
      elements: [
        defineElement({
          type: 'box',
          version: 1,
          props: schema({}),
          geometry: (el) => rect(el.w, el.h),
          actions: () => [{ id: 'box.action', label: 'Box Action', run: () => {} }],
        }),
      ],
    });

    const board = createTestBoard({ plugins: [testTools, customPlugin] });

    // Element placed near top edge (y = 5)
    const recTop = board.create({
      type: 'box',
      x: 500,
      y: 5,
      w: 100,
      h: 100,
    })!;

    board.select(recTop.id);
    const el = mountSelectionToolbar(board);

    // Auto-flip to below because top < 10
    expect(el.dataset.placement).toBe('below');
    // Placed below the bottom of the element (105 + GAP)
    const topPx = parseFloat(el.style.top);
    expect(topPx).toBeGreaterThan(105);

    // Element placed near left edge (x = 0)
    const recLeft = board.create({
      type: 'box',
      x: 0,
      y: 400,
      w: 50,
      h: 50,
    })!;

    board.select(recLeft.id);
    // Reposition clamped left edge inside viewport (at least halfWidth + 10)
    const leftPx = parseFloat(el.style.left);
    expect(leftPx).toBeGreaterThanOrEqual(140);
  });
});
