import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@kujam/core';
import { createMemoryStorage } from './index.js';

describe('createMemoryStorage', () => {
  it('menyimpan salinan dokumen tanpa mengubah nilai NaN atau undefined', async () => {
    const storage = createMemoryStorage();
    const doc = createEmptyDocument({ ratio: Number.NaN, note: undefined });
    await storage.save('b1', { document: doc });

    doc.meta.extra = true;
    const loaded = await storage.load('b1');
    expect(loaded).toEqual(createEmptyDocument({ ratio: Number.NaN, note: undefined }));
    expect(loaded).not.toBe(doc);
  });

  it('menyimpan update biner dan mengembalikan null untuk papan yang belum ada', async () => {
    const storage = createMemoryStorage();
    await storage.save('b1', { update: new Uint8Array([1, 2]) });
    expect(Array.from((await storage.load('b1')) as Uint8Array)).toEqual([1, 2]);
    await expect(storage.load('nope')).resolves.toBeNull();
  });
});
