// BOARD-106: lint fixture. Global DOM access in @kujam/core.
export const width = window.innerWidth;
export const title = document.title;
export const isElement = (value: unknown) => value instanceof HTMLElement;
