// Quill 2 minimal: tebal, miring, tautan, daftar. Tanpa tema dan toolbar (UI milik @kujam/ui).
import Quill from 'quill/core';
import Delta from 'quill-delta';
import Bold from 'quill/formats/bold';
import Italic from 'quill/formats/italic';
import Link from 'quill/formats/link';
import ListItem, { ListContainer } from 'quill/formats/list';

Quill.register(
  {
    'formats/bold': Bold,
    'formats/italic': Italic,
    'formats/link': Link,
    'formats/list': ListItem,
    'formats/list-container': ListContainer,
  },
  true,
);

export function mount(el: HTMLElement) {
  const quill = new Quill(el, { formats: ['bold', 'italic', 'link', 'list'] });
  // Isi elemen non-konten dari HTML tempelan dibuang, bukan dijadikan teks.
  for (const tag of ['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT'])
    quill.clipboard.addMatcher(tag, () => new Delta());
  return quill;
}
