// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createBoard, defineElement, rect, schema, string, testElementContract } from '@kujam/core';
import { contactCard, contactCardPlugin, createFakeContactApi, type Contact } from './index.js';

const ayu: Contact = {
  id: 'c-ayu',
  name: 'Ayu Lestari',
  role: 'Desainer produk',
  company: 'Studio Arunika',
  email: 'ayu@arunika.example',
  color: '#2563eb',
};

describe('BOARD-1207: contact card follows the custom element contract', () => {
  it('passes testElementContract with data, DOM, and every placeholder', () => {
    expect(
      testElementContract(contactCard, {
        props: { contactId: 'c-ayu' },
        data: ayu,
        createHost: () => document.createElement('div'),
      }),
    ).toEqual([]);
  });

  it('renders untrusted data as text and rejects unsafe links', () => {
    const host = document.createElement('div');
    const hostile = { ...ayu, name: '<img src=x onerror=alert(1)>', email: 'x" onclick="alert(1)' };
    const view = contactCard.render!.html!(
      host,
      { props: { contactId: 'c-ayu' } } as never,
      hostile,
      { emit: () => {} } as never,
    );
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('strong')!.textContent).toBe(hostile.name);
    // The hostile address does not form a valid mailto: URL, so the link gets no href at all.
    expect(host.querySelector('a')!.getAttribute('href') ?? '').not.toContain('javascript');
    view.destroy();
    expect(host.childElementCount).toBe(0);
  });
});

describe('testElementContract catches broken elements', () => {
  it('reports throwing callbacks, bad returns, and invalid defaults', () => {
    const broken = defineElement({
      type: 'broken',
      version: 1,
      props: schema({ ref: string({ maxLength: 3 }) }),
      defaults: { ref: 'ok' },
      geometry: (el) => rect(el.w, el.h),
      resolve: () => ({ ok: true }),
      render: {
        html: () => ({ update: () => {} }) as never,
        canvas: () => {
          throw new Error('canvas bug');
        },
      },
      placeholder: () => ({}) as never,
      actions: () => [
        { id: 'a', label: 'A', run: () => {} },
        { id: 'a', label: 'A', run: () => {} },
      ],
      a11y: () => ({ role: 'group' }) as never,
    });
    const checks = testElementContract(broken, {
      props: { ref: 'too long' },
      createHost: () => document.createElement('div'),
    }).map((i) => i.check);
    expect(checks).toEqual(
      expect.arrayContaining([
        'defaults',
        'resolve',
        'render.canvas (no data)',
        'render.html',
        'placeholder(loading)',
        'actions',
        'a11y',
      ]),
    );
  });
});

describe('fake contact API', () => {
  it('answers every outcome, globally or per contact, sync or async', async () => {
    const api = createFakeContactApi();
    api.setBehavior({ mode: 'sync' });
    expect(api.resolve('c-ayu')).toMatchObject({ name: 'Ayu Lestari' });
    expect(api.resolve('missing')).toEqual({ status: 'not-found' });

    api.setBehavior({ outcome: 'forbidden' }, 'c-bima');
    expect(api.resolve('c-bima')).toEqual({ status: 'forbidden' });
    api.setBehavior({ outcome: 'throw' }, 'c-citra');
    expect(() => api.resolve('c-citra')).toThrow(/melempar/);
    api.setBehavior(null, 'c-bima');
    expect(api.resolve('c-bima')).toMatchObject({ name: 'Bima Pratama' });

    api.setBehavior({ mode: 'async', latencyMs: 5 });
    await expect(api.resolve('c-ayu')).resolves.toMatchObject({ name: 'Ayu Lestari' });
  });

  it('drives a board: data, invalidate on change, and the call action', async () => {
    const api = createFakeContactApi();
    api.setBehavior({ mode: 'sync' });
    const board = createBoard({
      plugins: [contactCardPlugin],
      resolvers: { contact: (id) => api.resolve(id) },
    });
    const actions: unknown[] = [];
    board.on('action', (e) => actions.push(e));
    api.onChange((id) => board.invalidate('contact', id));
    board.create({
      id: 'k1',
      type: 'contact-card',
      x: 0,
      y: 0,
      w: 240,
      h: 112,
      props: { contactId: 'c-ayu' },
    });

    expect(board.getElementData('k1')).toMatchObject({
      status: 'ready',
      data: { role: 'Desainer produk' },
    });
    api.update('c-ayu', { role: 'Kepala desain' });
    expect(board.getElementData('k1')).toMatchObject({ data: { role: 'Kepala desain' } });

    board
      .getActions('k1')
      .find((a) => a.id === 'contact.call')!
      .run();
    expect(actions).toEqual([{ name: 'contact:call', payload: { contactId: 'c-ayu' } }]);
  });
});
