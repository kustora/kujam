import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDocument } from '@kujam/core';
import { createHttpStorage } from './index.js';

function mockFetch(response: Response) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createHttpStorage', () => {
  const storage = createHttpStorage({ baseUrl: 'https://api.test/boards/' });

  it('save mengirim dokumen sebagai JSON', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    const doc = createEmptyDocument();
    await storage.save('b 1', { document: doc });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/boards/b%201');
    expect(init?.method).toBe('PUT');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual(doc);
  });

  it('save mengirim update biner sebagai octet-stream, bukan null', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    const update = new Uint8Array([1, 2, 3]);
    await storage.save('b1', { update });

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/octet-stream',
    );
    expect(Array.from(init?.body as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('save tanpa document dan update melempar error tanpa memanggil server', async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    await expect(storage.save('b1', {})).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('load mengembalikan dokumen JSON', async () => {
    const doc = createEmptyDocument();
    mockFetch(
      new Response(JSON.stringify(doc), { headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(storage.load('b1')).resolves.toEqual(doc);
  });

  it('load mengembalikan Uint8Array untuk respons biner', async () => {
    mockFetch(
      new Response(new Uint8Array([9, 8, 7]), {
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    );
    const result = await storage.load('b1');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result as Uint8Array)).toEqual([9, 8, 7]);
  });

  it.each([
    ['404', new Response('not found', { status: 404 })],
    ['204', new Response(null, { status: 204 })],
    ['200 dengan body kosong', new Response('', { status: 200 })],
  ])('load mengembalikan null untuk %s', async (_label, response) => {
    mockFetch(response);
    await expect(storage.load('b1')).resolves.toBeNull();
  });

  it('load melempar error untuk status gagal', async () => {
    mockFetch(new Response('boom', { status: 500 }));
    await expect(storage.load('b1')).rejects.toThrow('500');
  });
});
