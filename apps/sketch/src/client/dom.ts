/** Small DOM helpers; nothing here parses HTML strings (BOARD-2001). */

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/** Creates an element: `on*` keys become listeners, `true` booleans become empty attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else if (key === 'class') {
      el.className = String(value);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 24 × 24 stroke icons, drawn for this app. */
const ICONS = {
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  share: [
    'M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    'M22 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    'M22 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    'M7.7 10.7l8.6-4.4',
    'M7.7 13.3l8.6 4.4',
  ],
  help: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',
    'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6',
    'M12 17.2v.1',
  ],
  open: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  save: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 19h16'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 2-2 5 5', 'M15 9.5a1.5 1.5 0 1 1 0-.01'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 13h6', 'M9 17h6'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5'],
  sun: [
    'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    'M12 2v2',
    'M12 20v2',
    'M2 12h2',
    'M20 12h2',
    'M4.9 4.9l1.4 1.4',
    'M17.7 17.7l1.4 1.4',
    'M4.9 19.1l1.4-1.4',
    'M17.7 6.3l1.4-1.4',
  ],
  command: ['M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z'],
  keyboard: ['M3 6h18v12H3z', 'M7 10h.01', 'M11 10h.01', 'M15 10h.01', 'M7 14h10'],
  github: [
    'M9 19c-4 1.5-4-2-6-2.5',
    'M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21',
  ],
  copy: ['M8 8h12v12H8z', 'M4 16V4h12'],
  exit: ['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h11'],
  users: [
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    'M2 21a7 7 0 0 1 14 0',
    'M16 3.5a4 4 0 0 1 0 7',
    'M22 21a7 7 0 0 0-4-6.3',
  ],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Saves a blob as a file through a temporary link. */
export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `localStorage` that never throws (private mode, blocked storage). */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // The value lasts until the page reloads.
    }
  },
};

/** Same for `sessionStorage`, used to hand content over across a reload. */
export const session = {
  take(key: string): string | null {
    try {
      const value = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      return value;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};
