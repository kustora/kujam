import { mount } from './editors/quill.ts';
import { normalizeRichText } from './model.ts';

const quill = mount(document.getElementById('editor')!);
const out = document.getElementById('out')!;
quill.on('text-change', () => {
  out.textContent = JSON.stringify(normalizeRichText(quill.getContents().ops), null, 1);
});

declare global {
  interface Window {
    lab: { quill: typeof quill; model: () => unknown; raw: () => unknown; xss: number };
  }
}
window.lab = {
  quill,
  model: () => normalizeRichText(quill.getContents().ops),
  raw: () => quill.getContents().ops,
  xss: 0,
};
quill.focus();
