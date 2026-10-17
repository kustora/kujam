// Type tests for BOARD-601: checked by `tsc --noEmit` (pnpm typecheck), with no runtime code.
import type {
  AnyElementDefinition,
  ElementDefinition,
  ElementPropsOf,
  ElementResize,
  ResolveError,
  createElementRegistry,
  defineElement,
} from './elements.js';
import type { Geometry, rect } from '../geometry/geometry.js';
import type { enumOf, nullable, optional, schema, string } from '../document/schema.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare const define: typeof defineElement;
declare const registry: typeof createElementRegistry;
declare const s: typeof schema;
declare const str: typeof string;
declare const en: typeof enumOf;
declare const opt: typeof optional;
declare const nul: typeof nullable;
declare const box: typeof rect;

type CardProps = { refId: string; size: 's' | 'm' | 'l'; note?: string; owner: string | null };

const card = define({
  type: 'contact-card',
  version: 1,
  props: s({ refId: str(), size: en(['s', 'm', 'l']), note: opt(str()), owner: nul(str()) }),
  defaults: { size: 'm', owner: null },
  geometry: (el) => {
    const _p: Expect<Equal<typeof el.props, CardProps>> = true;
    return box(el.w, el.h);
  },
  resize: (el, proposed) => ({ w: proposed.w, h: el.props.size === 's' ? 40 : proposed.h }),
  render: {
    canvas: (g, el, _data, _lod) => {
      const _p: Expect<Equal<typeof el.props.size, 's' | 'm' | 'l'>> = true;
      const _d: Expect<Equal<typeof _data, undefined>> = true;
      const _z: Expect<Equal<typeof _lod.compact, boolean>> = true;
      g.fillText(el.props.refId, 0, 0);
    },
  },
  onDoubleClick: (el, ctx) => ctx.emit('open', el.props.refId),
  migrate: { 0: (props) => ({ ...props, size: 'm' }) },
  a11y: (el, _data, ctx) => ({ role: 'article', label: `${ctx.locale}: ${el.props.refId}` }),
  export: { text: (el) => el.props.note ?? el.props.refId },
});

// Element with external data: `D` is inferred from `resolve`.
interface Contact {
  name: string;
}
declare function fetchContact(id: string): Promise<Contact>;

const resolved = define({
  type: 'resolved-card',
  version: 1,
  props: s({ refId: str() }),
  resolve: (el) => fetchContact(el.props.refId),
  render: {
    html: (_host, _el, _data) => {
      const _d: Expect<Equal<typeof _data, Contact | undefined>> = true;
      return { update() {}, destroy() {} };
    },
  },
  lod: { compactBelowZoom: 0.4 },
  actions: (_el, data) => [{ id: 'open', label: data?.name ?? '', run: () => {} }],
  placeholder: (reason) => ({ label: reason === 'forbidden' ? 'Terkunci' : 'Tidak tersedia' }),
  a11y: (_el, data) => ({ role: 'article', label: data?.name ?? '' }),
});

// Specific definitions fit into AnyElementDefinition (registries, plugin lists).
const _all: AnyElementDefinition[] = [card, resolved];
registry([card, resolved]).register(card);

define({
  type: 'bad-defaults',
  version: 1,
  props: s({ size: en(['s', 'm']) }),
  // @ts-expect-error default value outside the enum
  defaults: { size: 'xl' },
});

define({
  type: 'bad-key',
  version: 1,
  props: s({ size: en(['s', 'm']) }),
  // @ts-expect-error default key not in the schema
  defaults: { colour: 'red' },
});

define({
  type: 'bad-callback',
  version: 1,
  props: s({ size: en(['s', 'm']) }),
  // @ts-expect-error props have no `refId`
  export: { text: (el) => el.props.refId },
});

define({
  type: 'bad-resize',
  version: 1,
  props: s({}),
  // @ts-expect-error unknown resize mode
  resize: 'scale',
});

export type Checks = [
  Expect<Equal<typeof card.type, 'contact-card'>>,
  Expect<Equal<ElementPropsOf<typeof card>, CardProps>>,
  Expect<
    Equal<typeof card, ElementDefinition<'contact-card', (typeof card.props)['shape'], undefined>>
  >,
  Expect<Equal<ReturnType<NonNullable<typeof card.geometry>>, Geometry>>,
  Expect<Equal<ElementPropsOf<string>, never>>,
  Expect<
    Equal<
      ElementResize<object> extends string | ((...args: never[]) => unknown) ? true : false,
      true
    >
  >,
];
// Synchronous resolver from a cache: `ResolveError` is removed from the data type.
declare function cachedContact(id: string): Contact | ResolveError;

const _sync = define({
  type: 'sync-card',
  version: 1,
  props: s({ refId: str() }),
  resolve: (el, _ctx) => {
    const _r: Expect<
      Equal<typeof _ctx.resolvers, Readonly<Record<string, (id: string) => unknown>>>
    > = true;
    return cachedContact(el.props.refId);
  },
  export: {
    text: (_el, data) => {
      const _d: Expect<Equal<typeof data, Contact | undefined>> = true;
      return data?.name ?? '';
    },
  },
});
