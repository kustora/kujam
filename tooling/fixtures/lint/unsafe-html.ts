export function renderUnsafe(el: HTMLElement, raw: string): void {
  el.innerHTML = raw;
  el.outerHTML = raw;
  el.insertAdjacentHTML('beforeend', raw);
  document.write(raw);
}
