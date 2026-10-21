/**
 * "Contact card": a generic custom element with external data (BOARD-1207).
 *
 * Its props hold only a contact ID; name, role, company, and email come from the `contact`
 * resolver of the application. It shows the whole custom element contract:
 *
 * - `resolve` reads `ctx.resolvers.contact(id)`, so `board.invalidate('contact', id)` reaches it;
 * - `render.html` builds DOM with `textContent` and CSSOM only (ADR-009 T8), with one
 *   `data-board-interactive` button; `update` changes only what differs;
 * - `render.canvas` draws a compact card (for exports and, later, LOD);
 * - `placeholder`, `actions`, `a11y`, and `export.text` complete it.
 */

import {
  defineElement,
  definePlugin,
  rect,
  sanitizeUrl,
  schema,
  string,
  type ElementHtmlHost,
} from '@kujam/core';
import type { Contact } from './fake-api.js';

/** Default size of a new contact card, in board units. */
export const CONTACT_CARD_SIZE = Object.freeze({ w: 300, h: 112 });

const HEX = /^#[0-9a-f]{6}$/i;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]!.toUpperCase())
    .join('');
}

/** Builds the card DOM once; `show` fills it from data. */
function buildCard(host: HTMLElement) {
  const doc = host.ownerDocument;
  const card = doc.createElement('div');
  Object.assign(card.style, {
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    padding: '12px 14px',
    borderRadius: '12px',
    background: '#FFFFFF',
    border: '1px solid #E3E1DA',
    boxShadow: '0 4px 12px rgba(23, 25, 30, 0.08)',
    fontFamily: 'Inter, system-ui, sans-serif',
    color: '#17191E',
    overflow: 'hidden',
  } satisfies Partial<CSSStyleDeclaration>);

  const avatar = doc.createElement('div');
  Object.assign(avatar.style, {
    flex: '0 0 44px',
    height: '44px',
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: '15px',
  } satisfies Partial<CSSStyleDeclaration>);

  const text = doc.createElement('div');
  Object.assign(text.style, { minWidth: '0', flex: '1', display: 'grid', gap: '2px' });
  const name = doc.createElement('strong');
  const role = doc.createElement('span');
  const email = doc.createElement('a');
  for (const line of [name, role, email]) {
    Object.assign(line.style, {
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
  }
  Object.assign(name.style, { fontSize: '14px' });
  Object.assign(role.style, { fontSize: '12px', color: '#4A4F59' });
  Object.assign(email.style, { fontSize: '12px', color: '#2F6FDB', textDecoration: 'none' });
  // Links are interactive: clicking them opens mail instead of selecting the card.
  email.dataset.boardInteractive = '';
  email.rel = 'noopener noreferrer';
  text.append(name, role, email);

  const call = doc.createElement('button');
  call.type = 'button';
  call.textContent = 'Hubungi';
  call.dataset.boardInteractive = '';
  Object.assign(call.style, {
    flex: 'none',
    font: 'inherit',
    fontSize: '12px',
    padding: '6px 10px',
    borderRadius: '8px',
    border: '1px solid #D5D2C9',
    background: '#F2F1EC',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);

  card.append(avatar, text, call);
  host.append(card);

  return {
    call,
    show(contact: Contact | undefined): void {
      // Data is untrusted: text only through textContent, URLs through sanitizeUrl.
      name.textContent = contact?.name ?? '';
      role.textContent = contact ? `${contact.role} · ${contact.company}` : '';
      email.textContent = contact?.email ?? '';
      const href = contact ? sanitizeUrl(`mailto:${contact.email}`, ['mailto:']) : null;
      if (href) email.href = href;
      else email.removeAttribute('href');
      avatar.textContent = contact ? initials(contact.name) : '';
      avatar.style.background = contact && HEX.test(contact.color) ? contact.color : '#8A8F99';
    },
  };
}

/**
 * The contact card element. Register it with {@link contactCardPlugin} and a `contact` resolver.
 */
export const contactCard = defineElement({
  type: 'contact-card',
  version: 1,
  props: schema({ contactId: string({ maxLength: 128 }) }),
  defaults: { contactId: '' },
  geometry: (el) => rect(el.w, el.h),
  lod: { compactBelowZoom: 0.4 },
  resolve: (el, ctx) => ctx.resolvers.contact!(el.props.contactId) as Contact | Promise<Contact>,
  placeholder: (reason) => ({
    label:
      reason === 'forbidden' ? 'Kontak privat' : reason === 'not-found' ? 'Kontak dihapus' : '',
  }),
  render: {
    html(host: ElementHtmlHost, el, data, ctx) {
      const view = buildCard(host as HTMLElement);
      let current = el;
      view.call.addEventListener('click', () =>
        ctx.emit('contact:call', { contactId: current.props.contactId }),
      );
      view.show(data);
      return {
        update(next, nextData) {
          current = next;
          view.show(nextData);
        },
        destroy() {
          (host as HTMLElement).replaceChildren();
        },
      };
    },
    canvas(g, el, data, _lod) {
      g.beginPath();
      g.rect(0, 0, el.w, el.h);
      g.fillStyle = '#FFFFFF';
      g.fill();
      g.strokeStyle = '#E3E1DA';
      g.lineWidth = 1;
      g.stroke();
      if (!data) return;
      g.fillStyle = HEX.test(data.color) ? data.color : '#8A8F99';
      g.beginPath();
      g.arc(36, el.h / 2, 22, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#17191E';
      g.font = '600 14px Inter, system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.fillText(data.name, 70, el.h / 2 - 9, el.w - 84);
      g.fillStyle = '#4A4F59';
      g.font = '12px Inter, system-ui, sans-serif';
      g.fillText(data.role, 70, el.h / 2 + 10, el.w - 84);
    },
  },
  actions: (el, data, ctx) => [
    {
      id: 'contact.call',
      label: data ? `Hubungi ${data.name}` : 'Hubungi',
      group: 'contact',
      isEnabled: () => data !== undefined,
      run: () => ctx.emit('contact:call', { contactId: el.props.contactId }),
    },
    {
      id: 'contact.email',
      label: 'Kirim email',
      group: 'contact',
      isEnabled: () => data !== undefined,
      run: () => ctx.emit('contact:email', { contactId: el.props.contactId, email: data?.email }),
    },
  ],
  a11y: (_el, data) => ({
    role: 'group',
    label: data ? `Kartu kontak ${data.name}, ${data.role}` : 'Kartu kontak',
  }),
  export: { text: (_el, data) => (data ? `${data.name} (${data.email})` : '') },
});

/** Plugin with the contact card element. */
export const contactCardPlugin = definePlugin({
  id: 'example-contact-card',
  elements: [contactCard],
});
