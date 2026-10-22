// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBoard,
  type Board,
  type ElementCanvasContext,
  type ElementRecord,
} from '@kujam/core';
import {
  createEmbedElement,
  createEmbedPlugin,
  DEFAULT_ELEMENT_TYPES,
  defaultElements,
  defaultTools,
  resolveEmbed,
  type EmbedDomain,
  type EmbedProps,
} from '../index.js';

const DOMAINS: readonly (string | EmbedDomain)[] = [
  {
    origin: 'https://www.youtube-nocookie.com',
    sandbox: ['allow-scripts', 'allow-same-origin', 'allow-presentation'],
    allow: ['fullscreen', 'picture-in-picture'],
  },
  'https://*.example.com',
  { origin: 'http://localhost:8080', referrerPolicy: 'no-referrer' },
];

let boards: Board[] = [];
afterEach(() => {
  for (const b of boards) if (!b.disposed) b.dispose();
  boards = [];
  document.body.replaceChildren();
});

function setup(domains: readonly (string | EmbedDomain)[] = DOMAINS): Board {
  const board = createBoard({
    plugins: [defaultElements, defaultTools, createEmbedPlugin({ domains })],
  });
  boards.push(board);
  return board;
}

function embed(board: Board, url: string, title = ''): Readonly<ElementRecord<EmbedProps>> {
  return board.create({ type: 'embed', x: 0, y: 0, w: 480, h: 270, props: { url, title } });
}

/** Mounts the element's `render.html` into a fresh host, like the renderer's HTML layer. */
function mount(board: Board, el: Readonly<ElementRecord<EmbedProps>>) {
  const host = document.createElement('div');
  document.body.append(host);
  const view = board.elements.get('embed')!.render!.html!(
    host as never,
    el as never,
    undefined,
    board.elementContext,
  );
  return { host, view, iframe: () => host.querySelector('iframe') };
}

describe('BOARD-1107: embed is opt-in', () => {
  it('is not part of defaultElements', () => {
    expect(defaultElements.elements.map((d) => d.type)).not.toContain('embed');
    expect(DEFAULT_ELEMENT_TYPES).not.toContain('embed' as never);
    const board = createBoard({ plugins: [defaultElements] });
    boards.push(board);
    expect(board.elements.get('embed')).toBeUndefined();
  });

  it('is installed explicitly with an origin allowlist', () => {
    const board = setup();
    const el = embed(board, 'https://www.youtube-nocookie.com/embed/abc');
    expect(el.type).toBe('embed');
    expect(board.elements.get('embed')?.lod?.compactBelowZoom).toBe(0.5);
    expect(createEmbedElement({ domains: [], compactBelowZoom: 0.25 }).lod?.compactBelowZoom).toBe(
      0.25,
    );
  });

  it('rejects invalid allowlists when the element is created', () => {
    expect(() => createEmbedElement({ domains: ['https://example.com/path'] })).toThrow(TypeError);
    expect(() => createEmbedElement({ domains: ['example.com'] })).toThrow(TypeError);
    expect(() => createEmbedElement({ domains: ['ftp://example.com'] })).toThrow(TypeError);
    expect(() => createEmbedElement({ domains: ['https://*'] })).toThrow(TypeError);
    expect(() =>
      createEmbedElement({
        domains: [{ origin: 'https://a.test', sandbox: ['allow-top-navigation' as never] }],
      }),
    ).toThrow(/allow-top-navigation/);
    expect(() =>
      createEmbedElement({ domains: [{ origin: 'https://a.test', allow: ['camera *; x'] }] }),
    ).toThrow(TypeError);
    expect(() =>
      createEmbedElement({
        domains: [{ origin: 'https://a.test', referrerPolicy: 'unsafe-url' as never }],
      }),
    ).toThrow(TypeError);
    expect(() => createEmbedElement({} as never)).toThrow(TypeError);
  });
});

describe('BOARD-1107: resolveEmbed', () => {
  it('matches exact origins with their scheme and port', () => {
    expect(resolveEmbed('https://www.youtube-nocookie.com/embed/abc?x=1', DOMAINS)).toEqual({
      url: 'https://www.youtube-nocookie.com/embed/abc?x=1',
      origin: 'https://www.youtube-nocookie.com',
      sandbox: 'allow-scripts allow-same-origin allow-presentation',
      allow: 'fullscreen; picture-in-picture',
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
    expect(resolveEmbed('http://www.youtube-nocookie.com/embed/abc', DOMAINS)).toBeNull();
    expect(resolveEmbed('https://www.youtube-nocookie.com:444/embed', DOMAINS)).toBeNull();
    expect(resolveEmbed('https://youtube-nocookie.com/embed', DOMAINS)).toBeNull();
    expect(resolveEmbed('http://localhost:8080/demo', DOMAINS)?.referrerPolicy).toBe('no-referrer');
    expect(resolveEmbed('http://localhost:3000/demo', DOMAINS)).toBeNull();
  });

  it('matches wildcard subdomains but not the apex or look-alike hosts', () => {
    expect(resolveEmbed('https://docs.example.com/a', DOMAINS)?.sandbox).toBe('');
    expect(resolveEmbed('https://a.b.EXAMPLE.com/a', DOMAINS)?.origin).toBe(
      'https://a.b.example.com',
    );
    expect(resolveEmbed('https://example.com/a', DOMAINS)).toBeNull();
    expect(resolveEmbed('https://badexample.com/a', DOMAINS)).toBeNull();
    expect(resolveEmbed('https://example.com.evil.test/a', DOMAINS)).toBeNull();
  });

  it('never loads script, data, blob, or credential URLs', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://docs.example.com/123',
      'file:///etc/passwd',
      'https://user:pass@docs.example.com/',
      'not a url',
      '',
      `https://docs.example.com/${'a'.repeat(2048)}`,
    ]) {
      expect(resolveEmbed(url, DOMAINS)).toBeNull();
    }
    expect(resolveEmbed('https://docs.example.com/', [])).toBeNull();
  });
});

describe('BOARD-2003: sandboxed iframe', () => {
  it('always sets sandbox, referrerpolicy, lazy loading, and src last', () => {
    const board = setup();
    const { iframe } = mount(board, embed(board, 'https://docs.example.com/page', 'Docs'));
    const frame = iframe()!;
    expect(frame).not.toBeNull();
    expect(frame.hasAttribute('sandbox')).toBe(true);
    // No configured tokens: every sandbox restriction applies.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.hasAttribute('allow')).toBe(false);
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(frame.getAttribute('loading')).toBe('lazy');
    expect(frame.title).toBe('Docs');
    expect(frame.src).toBe('https://docs.example.com/page');
  });

  it('grants only the tokens and features configured for the matching origin', () => {
    const board = setup();
    const { iframe } = mount(board, embed(board, 'https://www.youtube-nocookie.com/embed/abc'));
    expect(iframe()!.getAttribute('sandbox')).toBe(
      'allow-scripts allow-same-origin allow-presentation',
    );
    expect(iframe()!.getAttribute('allow')).toBe('fullscreen; picture-in-picture');
    expect(iframe()!.title).toBe('www.youtube-nocookie.com');
  });

  it('shows a blocked card instead of an iframe for URLs outside the allowlist', () => {
    const board = setup();
    const { host, iframe } = mount(board, embed(board, 'https://evil.test/<b>x</b>'));
    expect(iframe()).toBeNull();
    const card = host.querySelector('[data-kujam-embed-blocked]')!;
    expect(card.textContent).toContain('Sematan diblokir');
    expect(card.textContent).toContain('evil.test');
    expect(host.querySelector('b')).toBeNull();
  });

  it('blocks the application origin when scripts and same-origin are both granted', () => {
    const own = window.location.origin;
    const board = setup([{ origin: own, sandbox: ['allow-scripts', 'allow-same-origin'] }]);
    const { iframe } = mount(board, embed(board, `${own}/inner`));
    expect(iframe()).toBeNull();
    // Either token alone cannot lift the sandbox, so it loads.
    const board2 = setup([{ origin: own, sandbox: ['allow-scripts'] }]);
    expect(mount(board2, embed(board2, `${own}/inner`)).iframe()).not.toBeNull();
  });

  it('follows URL changes on update and reuses the iframe otherwise', () => {
    const board = setup();
    const el = embed(board, 'https://docs.example.com/a');
    const { view, iframe } = mount(board, el);
    const first = iframe();
    view.update({ ...el, props: { ...el.props, title: 'Renamed' } } as never, undefined);
    expect(iframe()).toBe(first);
    expect(first!.title).toBe('Renamed');
    view.update(
      { ...el, props: { url: 'https://other.example.com/b', title: '' } } as never,
      undefined,
    );
    expect(iframe()).not.toBe(first);
    expect(iframe()!.src).toBe('https://other.example.com/b');
    view.update({ ...el, props: { url: 'https://evil.test/', title: '' } } as never, undefined);
    expect(iframe()).toBeNull();
    view.destroy();
  });
});

describe('BOARD-1107: interaction only after a double click', () => {
  it('ignores the pointer until double-clicked, and stops on a press outside or Escape', () => {
    const board = setup();
    const el = embed(board, 'https://docs.example.com/a');
    const { host, view, iframe } = mount(board, el);
    const frame = iframe()!;
    expect(frame.style.pointerEvents).toBe('none');
    expect(frame.hasAttribute('data-board-interactive')).toBe(false);

    board.elements.get('embed')!.onDoubleClick!(el as never, board.elementContext);
    expect(frame.style.pointerEvents).toBe('auto');
    expect(host.dataset.kujamEmbedActive).toBe('true');

    // A press on the embed itself keeps it active.
    frame.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(frame.style.pointerEvents).toBe('auto');
    // A press anywhere else on the page ends it.
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(frame.style.pointerEvents).toBe('none');

    board.elements.get('embed')!.onDoubleClick!(el as never, board.elementContext);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(frame.style.pointerEvents).toBe('none');
    expect(host.dataset.kujamEmbedActive).toBe('false');
    view.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('activates through the select tool double click on the element', () => {
    const board = setup();
    board.camera.setViewport({ width: 1000, height: 1000 });
    const el = embed(board, 'https://docs.example.com/a');
    const { iframe, view } = mount(board, el);
    board.setTool('select');
    const base = {
      pointerId: 1,
      pointerType: 'mouse' as const,
      point: { x: 100, y: 100 },
      screen: board.camera.boardToScreen({ x: 100, y: 100 }),
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      button: 0,
      buttons: 1,
      modifiers: { shift: false, alt: false, ctrl: false, meta: false },
    };
    board.dispatch({ ...base, type: 'pointer-down', clickCount: 1 });
    board.dispatch({ ...base, type: 'pointer-up', buttons: 0 });
    expect(iframe()!.style.pointerEvents).toBe('none');
    board.dispatch({ ...base, type: 'pointer-down', clickCount: 2 });
    board.dispatch({ ...base, type: 'pointer-up', buttons: 0 });
    expect(iframe()!.style.pointerEvents).toBe('auto');
    expect(board.selection).toEqual([el.id]);
    view.destroy();
  });

  it('does nothing on double click when the element is not mounted', () => {
    const board = setup();
    const el = embed(board, 'https://docs.example.com/a');
    expect(() =>
      board.elements.get('embed')!.onDoubleClick!(el as never, board.elementContext),
    ).not.toThrow();
  });
});

describe('BOARD-1107: compact canvas card', () => {
  function mockContext() {
    const texts: string[] = [];
    const g = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      fillText: vi.fn((t: string) => texts.push(t)),
    } as unknown as ElementCanvasContext;
    return { g, texts };
  }

  it('draws the title and host, or a blocked card, without loading anything', () => {
    const board = setup();
    const canvas = board.elements.get('embed')!.render!.canvas!;
    const ok = mockContext();
    canvas(ok.g, embed(board, 'https://docs.example.com/a', 'Roadmap') as never, undefined, {
      zoom: 0.2,
      compact: true,
    });
    expect(ok.texts).toEqual(['Roadmap', 'docs.example.com']);
    const blocked = mockContext();
    canvas(
      blocked.g,
      embed(board, 'https://evil.test/') as never,
      undefined,
      { zoom: 0.2, compact: true },
      board.elementContext,
    );
    expect(blocked.texts[0]).toBe('Sematan diblokir');
  });

  it('labels the element for assistive technology', () => {
    const board = setup();
    const el = embed(board, 'https://docs.example.com/a', 'Roadmap');
    const a11y = board.elements.get('embed')!.a11y!(el as never, undefined, board.elementContext);
    expect(a11y).toMatchObject({ role: 'group', label: 'Sematan: Roadmap' });
  });
});
