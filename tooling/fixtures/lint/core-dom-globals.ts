// BOARD-106: fixture lint. Akses DOM global di @kujam/core.
export const width = window.innerWidth;
export const title = document.title;
export const isElement = (value: unknown) => value instanceof HTMLElement;
