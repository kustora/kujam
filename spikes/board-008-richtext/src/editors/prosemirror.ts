// ProseMirror minimal: paragraf, daftar, tebal, miring, tautan.
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { Schema } from 'prosemirror-model';
import { addListNodes, liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

const base = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    text: { group: 'inline' },
  },
  marks: {
    strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [
        { tag: 'a[href]', getAttrs: (d) => ({ href: (d as HTMLElement).getAttribute('href') }) },
      ],
      toDOM: (m) => ['a', { href: m.attrs.href as string }, 0],
    },
  },
});
const schema = new Schema({
  nodes: addListNodes(base.spec.nodes, 'paragraph block*', 'block'),
  marks: base.spec.marks,
});

export function mount(el: HTMLElement) {
  const item = schema.nodes.list_item!;
  const state = EditorState.create({
    schema,
    plugins: [
      keymap({
        'Mod-b': toggleMark(schema.marks.strong!),
        'Mod-i': toggleMark(schema.marks.em!),
        Enter: splitListItem(item),
        Tab: sinkListItem(item),
        'Shift-Tab': liftListItem(item),
      }),
      keymap(baseKeymap),
    ],
  });
  return new EditorView(el, { state });
}
