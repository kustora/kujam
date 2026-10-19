/**
 * Test harness scenario for Playwright E2E and visual tests (BOARD-104, BOARD-2415).
 *
 * Query:
 * - `fixture=<version>/<name>`: loads a release fixture from `fixtures/documents/`, for example
 *   `0.1.0/kitchen-sink`. Without it the board starts empty.
 * - `ui=1`: mounts the `@kujam/ui` controls (off by default for stable screenshots).
 * - `bg=dots|grid|none`: board background (default `none`).
 * - `theme=dark`: dark theme.
 * - `locale=en`: English strings (default `id`).
 *
 * Camera animations are off so screenshots and assertions do not depend on timing.
 */

import { createBoard, defaultCommands, type BoardDocument } from '@kujam/core';
import { mountRenderer, type BoardBackground } from '@kujam/renderer';
import { attachTextEditor, defaultElements, defaultTools } from '@kujam/shapes';
import { mountDefaultUi } from '@kujam/ui';
import { h, json, section } from '../dom.js';
import { defineScenario } from '../scenario.js';

const fixtureModules = import.meta.glob<BoardDocument>('../../../../fixtures/documents/*/*.json', {
  eager: true,
  import: 'default',
});

/** Release fixtures by `<version>/<name>`. */
const FIXTURES = new Map(
  Object.entries(fixtureModules).map(([path, doc]) => [
    path.replace(/^.*fixtures\/documents\//, '').replace(/\.json$/, ''),
    doc,
  ]),
);

const BACKGROUNDS: readonly BoardBackground[] = ['dots', 'grid', 'none'];

export default defineScenario({
  id: 'harness',
  title: 'Harness uji',
  description: 'Papan polos untuk tes Playwright: fixture lewat ?fixture=, UI lewat ?ui=1.',
  order: 90,
  layout: 'board',
  mount({ main, controls, debug, state, expose }) {
    const fixtureName = state.get('fixture');
    const fixture = fixtureName ? FIXTURES.get(fixtureName) : undefined;
    if (fixtureName && !fixture) {
      main.append(h('p', { class: 'muted' }, `Fixture tidak ditemukan: ${fixtureName}`));
      return;
    }

    const board = createBoard({
      locale: state.get('locale') === 'en' ? 'en' : 'id',
      plugins: [defaultCommands, defaultElements, defaultTools],
      reducedMotion: true,
      ...(fixture ? { document: fixture } : {}),
    });
    if (state.get('theme') === 'dark') board.setTheme('dark');
    expose(board);

    const bg = state.get('bg') as BoardBackground | null;
    const view = mountRenderer(board, main, {
      background: bg && BACKGROUNDS.includes(bg) ? bg : 'none',
    });
    const textEditor = attachTextEditor(view);
    const ui = state.get('ui') === '1' ? mountDefaultUi({ board, container: main }) : null;
    board.setTool('select');

    controls.append(
      section(
        'Fixture',
        h(
          'ul',
          { class: 'muted' },
          ...[...FIXTURES.keys()].map((name) => h('li', {}, h('code', {}, name))),
        ),
      ),
    );
    debug.append(section('Opsi', h('pre', {}, json({ fixture: fixtureName, ui: !!ui }))));

    return () => {
      ui?.unmount();
      textEditor.detach();
      view.unmount();
      board.dispose();
    };
  },
});
