// Lexical minimal: rich text, daftar, tautan.
import { LinkNode } from '@lexical/link';
import { ListItemNode, ListNode, registerList } from '@lexical/list';
import { HeadingNode, QuoteNode, registerRichText } from '@lexical/rich-text';
import { createEditor } from 'lexical';

export function mount(el: HTMLElement) {
  const editor = createEditor({
    namespace: 'kujam',
    nodes: [ListNode, ListItemNode, LinkNode, HeadingNode, QuoteNode],
    onError: console.error,
  });
  editor.setRootElement(el);
  registerRichText(editor);
  registerList(editor);
  return editor;
}
