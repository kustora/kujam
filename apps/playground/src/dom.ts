/**
 * Helper kecil untuk membangun DOM tanpa `innerHTML`, agar data dari URL atau input tidak pernah
 * ditafsirkan sebagai HTML.
 */
type Child = Node | string | number | null | undefined | false;

type Props = {
  class?: string;
  style?: string;
  dataset?: Record<string, string>;
} & Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'style') el.style.cssText = String(value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function')
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key in el) (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h('section', { class: 'panel-section' }, h('h3', {}, title), ...children);
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
