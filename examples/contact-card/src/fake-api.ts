/**
 * Fake contact API for the contact card example (BOARD-1207) and the custom element lab
 * (BOARD-2411). Every response can be made slow, synchronous, forbidden, missing, failing, or
 * throwing, globally or per contact, to exercise every data state of a custom element.
 */

/** A contact as the fake API returns it. */
export interface Contact {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly company: string;
  readonly email: string;
  /** Avatar color, `#rrggbb`. */
  readonly color: string;
}

/**
 * What a request returns: the contact (`ok`), a `ResolveError` (`forbidden`, `not-found`,
 * `error`), or an exception (`throw`).
 */
export type FakeOutcome = 'ok' | 'forbidden' | 'not-found' | 'error' | 'throw';

/** How the fake API answers. */
export interface FakeBehavior {
  /** `sync` answers immediately (like a warm cache); `async` after `latencyMs`. */
  readonly mode: 'sync' | 'async';
  readonly latencyMs: number;
  readonly outcome: FakeOutcome;
}

export const DEFAULT_BEHAVIOR: Readonly<FakeBehavior> = Object.freeze({
  mode: 'async',
  latencyMs: 300,
  outcome: 'ok',
});

const SAMPLE: readonly Contact[] = [
  {
    id: 'c-ayu',
    name: 'Ayu Lestari',
    role: 'Desainer produk',
    company: 'Studio Arunika',
    email: 'ayu@arunika.example',
    color: '#2563eb',
  },
  {
    id: 'c-bima',
    name: 'Bima Pratama',
    role: 'Engineer',
    company: 'Sinar Data',
    email: 'bima@sinardata.example',
    color: '#16a34a',
  },
  {
    id: 'c-citra',
    name: 'Citra Wulandari',
    role: 'Manajer proyek',
    company: 'Kreasi Nusa',
    email: 'citra@kreasinusa.example',
    color: '#d97706',
  },
  {
    id: 'c-dimas',
    name: 'Dimas Saputra',
    role: 'Analis',
    company: 'Teluk Biru',
    email: 'dimas@telukbiru.example',
    color: '#7c3aed',
  },
  {
    id: 'c-eka',
    name: 'Eka Rahmawati',
    role: 'Penulis',
    company: 'Kata Kita',
    email: 'eka@katakita.example',
    color: '#e11d48',
  },
  {
    id: 'c-fajar',
    name: 'Fajar Nugroho',
    role: 'Konsultan',
    company: 'Bentang Raya',
    email: 'fajar@bentangraya.example',
    color: '#0891b2',
  },
];

const ROLES = [
  'Desainer produk',
  'Engineer',
  'Manajer proyek',
  'Analis',
  'Penulis',
  'Konsultan',
  'Peneliti',
];

export interface FakeContactApi {
  /** Resolver to register as `createBoard({ resolvers: { contact: api.resolve } })`. */
  resolve(id: string): unknown;
  /** Changes the behavior globally, or for one contact (`null` patch clears the override). */
  setBehavior(patch: Partial<FakeBehavior> | null, id?: string): void;
  behaviorOf(id: string): FakeBehavior;
  readonly globalBehavior: FakeBehavior;
  /** Every contact, sample ones first. */
  contacts(): readonly Contact[];
  /** Changes a contact's data, as if edited elsewhere; notifies `onChange`. */
  update(id: string, patch: Partial<Omit<Contact, 'id'>>): void;
  /** Changes one random contact's role; returns its ID. */
  randomize(): string | null;
  /** Called with the ID whose data changed, so the app can `board.invalidate('contact', id)`. */
  onChange(listener: (id: string) => void): () => void;
  /** Number of requests answered, for the lab's counters. */
  readonly calls: number;
}

export function createFakeContactApi(
  options: { contacts?: readonly Contact[] } = {},
): FakeContactApi {
  const store = new Map((options.contacts ?? SAMPLE).map((c) => [c.id, c] as const));
  let global: FakeBehavior = { ...DEFAULT_BEHAVIOR };
  const overrides = new Map<string, Partial<FakeBehavior>>();
  const listeners = new Set<(id: string) => void>();
  let calls = 0;

  const behaviorOf = (id: string): FakeBehavior => ({ ...global, ...overrides.get(id) });

  function answer(id: string, outcome: FakeOutcome): unknown {
    calls++;
    switch (outcome) {
      case 'forbidden':
        return { status: 'forbidden' };
      case 'not-found':
        return { status: 'not-found' };
      case 'error':
        return { status: 'error', message: 'Server kontak sedang bermasalah' };
      case 'throw':
        throw new Error(`API kontak melempar error untuk "${id}"`);
      default: {
        const contact = store.get(id);
        return contact ?? { status: 'not-found' };
      }
    }
  }

  return {
    resolve(id) {
      const behavior = behaviorOf(id);
      if (behavior.mode === 'sync') return answer(id, behavior.outcome);
      return new Promise((resolve, reject) => {
        setTimeout(
          () => {
            try {
              resolve(answer(id, behavior.outcome));
            } catch (error) {
              reject(error);
            }
          },
          Math.max(0, behavior.latencyMs),
        );
      });
    },
    setBehavior(patch, id) {
      if (id === undefined) global = { ...global, ...(patch ?? {}) };
      else if (patch === null) overrides.delete(id);
      else overrides.set(id, { ...overrides.get(id), ...patch });
    },
    behaviorOf,
    get globalBehavior() {
      return global;
    },
    contacts: () => [...store.values()],
    update(id, patch) {
      const current = store.get(id);
      if (!current) return;
      store.set(id, { ...current, ...patch });
      for (const listener of listeners) listener(id);
    },
    randomize() {
      const ids = [...store.keys()];
      if (ids.length === 0) return null;
      const id = ids[Math.floor(Math.random() * ids.length)]!;
      const role = ROLES[Math.floor(Math.random() * ROLES.length)]!;
      this.update(id, { role });
      return id;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get calls() {
      return calls;
    },
  };
}
