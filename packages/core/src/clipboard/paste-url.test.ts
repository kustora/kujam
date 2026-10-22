import { describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  createElementFromUrl,
  defineElement,
  definePlugin,
  isPastableUrl,
  PluginError,
  schema,
  string,
  type AnyPluginDefinition,
  type BoardErrorEvent,
  type BoardResolvers,
  type PasteUrlHook,
} from '../index.js';

interface LinkPreview {
  readonly title: string;
}

const linkCard = defineElement({
  type: 'link-card',
  version: 1,
  props: schema({ url: string() }),
  defaults: { url: '' },
  // Metadata comes from the host resolver (fetched server-side); the package never fetches.
  resolve: (el, ctx) =>
    ctx.resolvers.linkPreview!(el.props.url) as LinkPreview | Promise<LinkPreview>,
});

function plugin(id: string, onPasteUrl?: PasteUrlHook): AnyPluginDefinition {
  return definePlugin({ id, ...(onPasteUrl ? { onPasteUrl } : {}) });
}

function setup(plugins: AnyPluginDefinition[], resolvers: BoardResolvers = {}) {
  const board = createBoard({
    plugins: [definePlugin({ id: 'links', elements: [linkCard] }), ...plugins],
    resolvers,
  });
  const errors: BoardErrorEvent[] = [];
  board.on('error', (e) => errors.push(e));
  return { board, errors };
}

const linkHook: PasteUrlHook = (url) => ({ type: 'link-card', w: 200, h: 100, props: { url } });

describe('BOARD-1209: onPasteUrl hook', () => {
  it('validates onPasteUrl as a function', () => {
    expect(() => definePlugin({ id: 'x', onPasteUrl: 'nope' as never })).toThrow(PluginError);
  });

  it('only accepts single http and https URLs', () => {
    expect(isPastableUrl(' https://example.com/a ')).toBe(true);
    expect(isPastableUrl('http://example.com')).toBe(true);
    expect(isPastableUrl('javascript:alert(1)')).toBe(false);
    expect(isPastableUrl('mailto:a@example.com')).toBe(false);
    expect(isPastableUrl('https://a.com https://b.com')).toBe(false);
    expect(isPastableUrl('hello')).toBe(false);
  });

  it('creates the element from the first plugin that returns one, in installation order', () => {
    const first = vi.fn(() => null);
    const third = vi.fn(linkHook);
    const { board } = setup([plugin('a', first), plugin('b', linkHook), plugin('c', third)]);

    const el = createElementFromUrl(board, ' https://example.com/item ', { x: 500, y: 300 });

    expect(first).toHaveBeenCalledWith('https://example.com/item', { x: 500, y: 300 }, board);
    expect(third).not.toHaveBeenCalled();
    expect(el?.type).toBe('link-card');
    expect(el?.props).toEqual({ url: 'https://example.com/item' });
    // Centered on the paste point when the hook gives no position.
    expect(el).toMatchObject({ x: 400, y: 250, w: 200, h: 100 });
  });

  it('keeps an explicit position from the hook', () => {
    const { board } = setup([
      plugin('a', (url) => ({ type: 'link-card', x: 1, y: 2, w: 10, h: 10, props: { url } })),
    ]);
    expect(createElementFromUrl(board, 'https://e.com', { x: 50, y: 50 })).toMatchObject({
      x: 1,
      y: 2,
    });
  });

  it('is one undo step', () => {
    const { board } = setup([plugin('a', linkHook)]);
    const el = createElementFromUrl(board, 'https://e.com', { x: 0, y: 0 })!;
    expect(board.history.canUndo).toBe(true);
    board.undo();
    expect(board.getElement(el.id)).toBeUndefined();
    expect(board.history.canUndo).toBe(false);
  });

  it('creates the element immediately in its loading state, then fills in from the resolver', async () => {
    let finish!: (value: LinkPreview) => void;
    const linkPreview = vi.fn(() => new Promise<LinkPreview>((resolve) => (finish = resolve)));
    const { board } = setup([plugin('a', linkHook)], { linkPreview });

    const el = createElementFromUrl(board, 'https://example.com', { x: 0, y: 0 })!;
    expect(board.getElement(el.id)).toBeDefined();
    expect(board.getElementData(el.id).status).toBe('loading');
    expect(linkPreview).toHaveBeenCalledWith('https://example.com');

    finish({ title: 'Example' });
    await new Promise((r) => setTimeout(r, 0));
    expect(board.getElementData(el.id)).toMatchObject({
      status: 'ready',
      data: { title: 'Example' },
    });
  });

  it('returns undefined and creates nothing when no plugin claims the URL', () => {
    const { board } = setup([plugin('a', () => undefined), plugin('b')]);
    expect(createElementFromUrl(board, 'https://e.com', { x: 0, y: 0 })).toBeUndefined();
    expect(board.query()).toHaveLength(0);
  });

  it('never calls hooks for unsafe URLs or on a read-only board', () => {
    const hook = vi.fn(linkHook);
    const { board } = setup([plugin('a', hook)]);
    expect(createElementFromUrl(board, 'javascript:alert(1)', { x: 0, y: 0 })).toBeUndefined();
    board.setReadOnly(true);
    expect(createElementFromUrl(board, 'https://e.com', { x: 0, y: 0 })).toBeUndefined();
    expect(hook).not.toHaveBeenCalled();
  });

  it('isolates hook errors and invalid results as plugin-error, then asks the next plugin', () => {
    const { board, errors } = setup([
      plugin('throws', () => {
        throw new Error('boom');
      }),
      plugin('async', (() => Promise.resolve(null)) as never),
      plugin('invalid', (() => ({ nope: true })) as never),
      plugin('ok', linkHook),
    ]);

    const el = createElementFromUrl(board, 'https://e.com', { x: 0, y: 0 });

    expect(el?.type).toBe('link-card');
    expect(errors.map((e) => e.code)).toEqual(['plugin-error', 'plugin-error', 'plugin-error']);
    expect(errors[0]!.message).toMatch(/throws.*boom/);
  });
});
