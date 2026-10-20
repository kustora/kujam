import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachStorage, createBoard, createEmptyDocument, type SaveErrorEvent } from '@kujam/core';
import {
  createHttpStorage,
  HttpStorageError,
  type HttpStorageEvent,
  type HttpStorageOptions,
} from './index.js';

type FetchFn = NonNullable<HttpStorageOptions['fetch']>;

/** Fetch mock that answers with the given responses in order (the last one repeats). */
function fakeFetch(...responses: Array<Response | (() => Response)>) {
  let index = 0;
  return vi.fn<FetchFn>(async () => {
    const next = responses[Math.min(index++, responses.length - 1)]!;
    return typeof next === 'function' ? next() : next;
  });
}

function sent(fetchMock: ReturnType<typeof fakeFetch>, call = 0) {
  const [url, init] = fetchMock.mock.calls[call]!;
  return { url: String(url), init, headers: new Headers(init.headers) };
}

const url = (id: string) => `https://api.test/boards/${encodeURIComponent(id)}`;

function storageWith(fetchMock: FetchFn, options: Partial<HttpStorageOptions> = {}) {
  return createHttpStorage({ url, fetch: fetchMock, ...options });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BOARD-1604: options', () => {
  it('builds the request URL with the url function', async () => {
    const fetchMock = fakeFetch(new Response(null, { status: 204 }));
    const urlFn = vi.fn((id: string) => new URL(`https://api.test/v2/${encodeURIComponent(id)}`));
    await createHttpStorage({ url: urlFn, fetch: fetchMock }).save('b 1', {
      document: createEmptyDocument(),
    });
    expect(urlFn).toHaveBeenCalledWith('b 1');
    expect(sent(fetchMock).url).toBe('https://api.test/v2/b%201');
  });

  it('requires url to be a function', () => {
    expect(() =>
      createHttpStorage({ url: 'https://api.test' } as unknown as HttpStorageOptions),
    ).toThrow(TypeError);
  });

  it('sends static headers', async () => {
    const fetchMock = fakeFetch(new Response(null, { status: 204 }));
    await storageWith(fetchMock, { headers: { Authorization: 'Bearer static' } }).load('b1');
    expect(sent(fetchMock).headers.get('Authorization')).toBe('Bearer static');
    expect(sent(fetchMock).headers.get('Accept')).toBe(
      'application/json, application/octet-stream',
    );
  });

  it('awaits an async headers function before every request', async () => {
    const fetchMock = fakeFetch(new Response(null, { status: 204 }));
    let token = 0;
    const headers = vi.fn(async () => ({ Authorization: `Bearer t${++token}` }));
    const storage = storageWith(fetchMock, { headers });
    await storage.load('b1');
    await storage.save('b1', { document: createEmptyDocument() });

    expect(headers.mock.calls).toEqual([
      [{ boardId: 'b1', operation: 'load' }],
      [{ boardId: 'b1', operation: 'save' }],
    ]);
    expect(sent(fetchMock, 0).headers.get('Authorization')).toBe('Bearer t1');
    expect(sent(fetchMock, 1).headers.get('Authorization')).toBe('Bearer t2');
  });

  it('rejects without a request when the headers function throws', async () => {
    const fetchMock = fakeFetch(new Response(null, { status: 204 }));
    const storage = storageWith(fetchMock, {
      headers: async () => {
        throw new Error('no session');
      },
    });
    await expect(storage.load('b1')).rejects.toThrow('no session');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses globalThis.fetch at request time when no fetch is given', async () => {
    const storage = createHttpStorage({ url });
    const fetchMock = fakeFetch(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await storage.load('b1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('advertises debounceMs only when given', () => {
    const fetchMock = fakeFetch(new Response(null));
    expect(storageWith(fetchMock).debounceMs).toBeUndefined();
    expect(storageWith(fetchMock, { debounceMs: 250 }).debounceMs).toBe(250);
  });

  it('validates boardId', async () => {
    const fetchMock = fakeFetch(new Response(null));
    const storage = storageWith(fetchMock);
    await expect(storage.load('')).rejects.toThrow(TypeError);
    await expect(storage.save('', { document: createEmptyDocument() })).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('BOARD-1604: JSON and binary', () => {
  it('save sends a document as JSON with PUT', async () => {
    const fetchMock = fakeFetch(new Response(null, { status: 204 }));
    const doc = createEmptyDocument();
    await storageWith(fetchMock).save('b1', { document: doc });

    const { init, headers } = sent(fetchMock);
    expect(init.method).toBe('PUT');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(doc);
  });

  it('save sends a binary update as octet-stream', async () => {
    const fetchMock = fakeFetch(new Response(null, { status: 204 }));
    await storageWith(fetchMock).save('b1', { update: new Uint8Array([1, 2, 3]) });

    const { init, headers } = sent(fetchMock);
    expect(headers.get('Content-Type')).toBe('application/octet-stream');
    expect(Array.from(init.body as Uint8Array)).toEqual([1, 2, 3]);
  });

  it('save without document or update throws without a request', async () => {
    const fetchMock = fakeFetch(new Response(null, { status: 204 }));
    await expect(storageWith(fetchMock).save('b1', {})).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('load returns a JSON document', async () => {
    const doc = createEmptyDocument();
    const fetchMock = fakeFetch(
      new Response(JSON.stringify(doc), { headers: { 'Content-Type': 'application/json' } }),
    );
    await expect(storageWith(fetchMock).load('b1')).resolves.toEqual(doc);
    expect(sent(fetchMock).init.method).toBe('GET');
  });

  it('load returns a Uint8Array for a binary response', async () => {
    const fetchMock = fakeFetch(
      new Response(new Uint8Array([9, 8, 7]), {
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    );
    const result = await storageWith(fetchMock).load('b1');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result as Uint8Array)).toEqual([9, 8, 7]);
  });

  it.each([
    ['404', () => new Response('not found', { status: 404 })],
    ['204', () => new Response(null, { status: 204 })],
    ['200 with an empty body', () => new Response('', { status: 200 })],
    [
      'an empty binary body',
      () =>
        new Response(new Uint8Array(), { headers: { 'Content-Type': 'application/octet-stream' } }),
    ],
  ])('load returns null for %s', async (_label, response) => {
    await expect(storageWith(fakeFetch(response)).load('b1')).resolves.toBeNull();
  });
});

describe('BOARD-1604: 401, 403, and 409', () => {
  it.each([
    [401, 'unauthorized', true],
    [403, 'forbidden', false],
    [409, 'conflict', false],
    [412, 'conflict', false],
    [400, 'http', false],
    [404, 'http', false],
    [408, 'http', true],
    [429, 'http', true],
    [500, 'http', true],
    [503, 'http', true],
  ] as const)('save rejects status %i as %s (retryable: %s)', async (status, kind, retryable) => {
    const response = new Response('nope', { status });
    const error = await storageWith(fakeFetch(response))
      .save('b1', { document: createEmptyDocument() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpStorageError);
    expect(error).toMatchObject({
      name: 'HttpStorageError',
      kind,
      status,
      retryable,
      operation: 'save',
      boardId: 'b1',
      response,
    });
    expect((error as Error).message).toContain(String(status));
  });

  it('load rejects failed statuses with HttpStorageError', async () => {
    const error = await storageWith(fakeFetch(new Response('boom', { status: 500 })))
      .load('b1')
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'http', status: 500, operation: 'load' });
  });

  it('emits unauthorized, forbidden, and conflict events before rejecting', async () => {
    const fetchMock = fakeFetch(
      new Response(null, { status: 401 }),
      new Response(null, { status: 403 }),
      new Response(null, { status: 409 }),
      new Response(null, { status: 500 }),
    );
    const storage = storageWith(fetchMock);
    const events: Array<[string, HttpStorageEvent]> = [];
    for (const type of ['unauthorized', 'forbidden', 'conflict'] as const) {
      storage.on(type, (e) => events.push([type, e]));
    }

    const doc = { document: createEmptyDocument() };
    const e1 = await storage.load('b1').catch((e: unknown) => e);
    const e2 = await storage.save('b1', doc).catch((e: unknown) => e);
    const e3 = await storage.save('b1', doc).catch((e: unknown) => e);
    await storage.save('b1', doc).catch(() => {});

    expect(events).toEqual([
      ['unauthorized', { boardId: 'b1', operation: 'load', status: 401, error: e1 }],
      ['forbidden', { boardId: 'b1', operation: 'save', status: 403, error: e2 }],
      ['conflict', { boardId: 'b1', operation: 'save', status: 409, error: e3 }],
    ]);
    expect(Object.isFrozen(events[0]![1])).toBe(true);
  });

  it('removes listeners and reports listener errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage = storageWith(fakeFetch(new Response(null, { status: 403 })));
    const kept = vi.fn();
    const removed = vi.fn();
    storage.on('forbidden', () => {
      throw new Error('listener');
    });
    storage.on('forbidden', kept);
    const off = storage.on('forbidden', removed);
    off();

    await expect(storage.load('b1')).rejects.toBeInstanceOf(HttpStorageError);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('passes network errors from fetch through', async () => {
    const offline = new TypeError('Failed to fetch');
    const storage = storageWith(
      vi.fn<FetchFn>(async () => {
        throw offline;
      }),
    );
    await expect(storage.load('b1')).rejects.toBe(offline);
  });
});

describe('BOARD-1604: version conflicts with ETag', () => {
  const doc = () => ({ document: createEmptyDocument() });

  it('sends the ETag of the last load or save as If-Match', async () => {
    const fetchMock = fakeFetch(
      new Response('{}', { headers: { 'Content-Type': 'application/json', ETag: '"v1"' } }),
      new Response(null, { status: 204, headers: { ETag: '"v2"' } }),
      new Response(null, { status: 204, headers: { ETag: '"v3"' } }),
    );
    const storage = storageWith(fetchMock);

    await storage.load('b1');
    expect(storage.getVersion('b1')).toBe('"v1"');
    await storage.save('b1', doc());
    await storage.save('b1', doc());

    expect(sent(fetchMock, 0).headers.has('If-Match')).toBe(false);
    expect(sent(fetchMock, 1).headers.get('If-Match')).toBe('"v1"');
    expect(sent(fetchMock, 2).headers.get('If-Match')).toBe('"v2"');
    expect(storage.getVersion('b1')).toBe('"v3"');
    expect(storage.getVersion('other')).toBeNull();
  });

  it('forgets a stale ETag when the save response has none', async () => {
    const fetchMock = fakeFetch(
      new Response('{}', { headers: { ETag: '"v1"' } }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    );
    const storage = storageWith(fetchMock);
    await storage.load('b1');
    await storage.save('b1', doc());
    await storage.save('b1', doc());
    expect(sent(fetchMock, 2).headers.has('If-Match')).toBe(false);
    expect(storage.getVersion('b1')).toBeNull();
  });

  it('keeps the ETag after a conflict and overwrites after setVersion(null)', async () => {
    const fetchMock = fakeFetch(
      new Response('{}', { headers: { ETag: '"v1"' } }),
      new Response(null, { status: 412 }),
      new Response(null, { status: 204, headers: { ETag: '"v9"' } }),
    );
    const storage = storageWith(fetchMock);
    await storage.load('b1');

    await expect(storage.save('b1', doc())).rejects.toMatchObject({ kind: 'conflict' });
    expect(storage.getVersion('b1')).toBe('"v1"');

    storage.setVersion('b1', null);
    await storage.save('b1', doc());
    expect(sent(fetchMock, 2).headers.has('If-Match')).toBe(false);
    expect(storage.getVersion('b1')).toBe('"v9"');
  });

  it('setVersion sets the next If-Match and validates its input', async () => {
    const fetchMock = fakeFetch(new Response(null, { status: 204 }));
    const storage = storageWith(fetchMock);
    storage.setVersion('b1', 'W/"7"');
    await storage.save('b1', doc());
    expect(sent(fetchMock).headers.get('If-Match')).toBe('W/"7"');
    expect(() => storage.setVersion('b1', '')).toThrow(TypeError);
    expect(() => storage.setVersion('', 'x')).toThrow(TypeError);
  });

  it('clears the version when the board is not found', async () => {
    const storage = storageWith(fakeFetch(new Response(null, { status: 404 })));
    storage.setVersion('b1', '"v1"');
    await storage.load('b1');
    expect(storage.getVersion('b1')).toBeNull();
  });

  it('lets custom headers override If-Match', async () => {
    const fetchMock = fakeFetch(new Response(null, { status: 204 }));
    const storage = storageWith(fetchMock, { headers: { 'If-Match': '*' } });
    storage.setVersion('b1', '"v1"');
    await storage.save('b1', doc());
    expect(sent(fetchMock).headers.get('If-Match')).toBe('*');
  });
});

describe('BOARD-1604: integration with attachStorage', () => {
  let pages = 0;
  function change(board: ReturnType<typeof createBoard>): void {
    const n = ++pages;
    board.transact((tx) => {
      tx.put({ id: `page:${n}`, kind: 'page', name: `P${n}`, index: `a${n}`, meta: {} });
    });
  }

  async function attachedTo(fetchMock: FetchFn, options: Partial<HttpStorageOptions> = {}) {
    vi.useFakeTimers();
    const storage = storageWith(fetchMock, options);
    const board = createBoard();
    const attachment = attachStorage(board, storage, { boardId: 'b1', lifecycle: null });
    await attachment.ready;
    const errors: SaveErrorEvent[] = [];
    attachment.on('save:error', (e) => errors.push(e));
    return { storage, board, attachment, errors };
  }

  it.each([403, 409])('does not retry a save rejected with %i', async (status) => {
    const fetchMock = fakeFetch(
      new Response(null, { status: 404 }),
      () => new Response(null, { status }),
    );
    const { board, attachment, errors } = await attachedTo(fetchMock);

    change(board);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errors.map((e) => [e.attempt, e.willRetry])).toEqual([[1, false]]);
    expect(attachment.status).toBe('error');
    expect(attachment.dirty).toBe(true);
  });

  it('retries a 401 save with the token refreshed in the unauthorized listener', async () => {
    let token = 'expired';
    const fetchMock = vi.fn<FetchFn>(async (_url, init) => {
      if (init.method === 'GET') return new Response(null, { status: 404 });
      const auth = new Headers(init.headers).get('Authorization');
      return new Response(null, { status: auth === 'Bearer fresh' ? 204 : 401 });
    });
    const { storage, board, attachment, errors } = await attachedTo(fetchMock, {
      headers: async () => ({ Authorization: `Bearer ${token}` }),
    });
    storage.on('unauthorized', () => {
      token = 'fresh';
    });

    change(board);
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors.map((e) => [e.willRetry, (e.error as HttpStorageError).kind])).toEqual([
      [true, 'unauthorized'],
    ]);
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(attachment.status).toBe('idle');
    expect(attachment.dirty).toBe(false);
  });
});
