// Type tests for BOARD-602: checked by `tsc --noEmit` (pnpm typecheck), with no runtime code.
// Proves the `definePlugin` types, `elements`/`tools` tuple inference, and that plugins have
// no access to store internals beyond the public `Board` API.
import type {
  AnyPluginDefinition,
  Board,
  BoardPlugins,
  ElementRegistry,
  PluginDefinition,
  defineCommand,
  defineElement,
  definePlugin,
  defineTool,
  schema,
  string,
} from '../index.js';
import type { RecordStore } from '../document/store.js';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare const defPlugin: typeof definePlugin;
declare const defElement: typeof defineElement;
declare const defTool: typeof defineTool;
declare const defCmd: typeof defineCommand;
declare const s: typeof schema;
declare const str: typeof string;

const cardEl = defElement({
  type: 'contact-card',
  version: 1,
  props: s({ refId: str() }),
});

const stampTool = defTool({
  id: 'contoh.cap',
  initial: 'idle',
  states: { idle: {} },
});

const cmd = defCmd({
  id: 'contoh.aksi',
  label: 'command.contoh.aksi',
  run: () => {},
});

const samplePlugin = defPlugin({
  id: 'contoh.plugin',
  dependsOn: ['default-elements'],
  elements: [cardEl] as const,
  tools: [stampTool] as const,
  commands: [cmd],
  keybindings: { k: 'tool:contoh.cap' },
  permissions: (action, el, user) => {
    const _a: string = action;
    const _e: string | undefined = el?.type;
    const _u: string | undefined = user?.id;
    void _a;
    void _e;
    void _u;
    return true;
  },
  onDocumentSaved: (doc) => {
    const _v: number = doc.schemaVersion;
    void _v;
  },
  setup(board) {
    // BOARD-602 acceptance criterion: `board` inside `setup` is purely the public `Board` type,
    // with no access to the internal `RecordStore` (`store`, `replaceDocument`, `inTransaction`, `getRecord`).
    const _isPublicBoard: Expect<Equal<typeof board, Board>> = true;
    void _isPublicBoard;

    // @ts-expect-error -- plugins have no access to the internal `store`
    void board.store;
    // @ts-expect-error -- `replaceDocument` is an internal RecordStore method, not public Board
    void board.replaceDocument;
    // @ts-expect-error -- `inTransaction` is an internal RecordStore method, not public Board
    void board.inTransaction;
    // @ts-expect-error -- `getRecord` is an internal RecordStore method, not public Board
    void board.getRecord;

    return () => {};
  },
});

// Specific plugins fit into AnyPluginDefinition.
const _collection: readonly AnyPluginDefinition[] = [samplePlugin];
void _collection;

// Make sure no RecordStore property leaks into the Board type.
type InternalOnlyKeys = Exclude<keyof RecordStore, keyof Board>;

export type Checks = [
  Expect<Equal<(typeof samplePlugin)['id'], 'contoh.plugin'>>,
  Expect<Equal<(typeof samplePlugin)['elements'], readonly [typeof cardEl]>>,
  Expect<Equal<(typeof samplePlugin)['tools'], readonly [typeof stampTool]>>,
  Expect<
    typeof samplePlugin extends PluginDefinition<
      'contoh.plugin',
      readonly [typeof cardEl],
      readonly [typeof stampTool]
    >
      ? true
      : false
  >,
  Expect<Equal<Board['elements'], ElementRegistry>>,
  Expect<Equal<Board['plugins'], BoardPlugins>>,
  Expect<Equal<InternalOnlyKeys, 'getRecord' | 'inTransaction' | 'replaceDocument'>>,
  Expect<Equal<'store' extends keyof Board ? true : false, false>>,
];
