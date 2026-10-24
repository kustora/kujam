/**
 * The share dialog. From a local board it starts a session: it creates a room on the server and
 * moves the current drawing into it. Inside a room it shows the links this browser knows (the
 * creator knows both the edit and the view-only link), lets people change their display name, and
 * leaves the session with a copy of the drawing kept locally.
 */

import type { PresenceUser } from '@kujam/core';
import { MAX_ROOM_NAME, MAX_USER_NAME, type RoomRole } from '../shared/protocol.js';
import { knownLinks, shareUrl } from './api.js';
import { h, icon } from './dom.js';

export interface LocalShareOptions {
  readonly user: PresenceUser;
  /** Creates the room and switches to it; rejects with a message to show. */
  readonly start: (roomName: string, userName: string) => Promise<void>;
}

export interface RoomShareOptions {
  readonly user: PresenceUser;
  readonly roomId: string;
  readonly roomName: string;
  readonly role: RoomRole;
  readonly peers: () => readonly PresenceUser[];
  readonly rename: (name: string) => void;
  readonly leave: () => void;
}

function dialog(...children: (Node | null)[]): HTMLDialogElement {
  const el = h(
    'dialog',
    { class: 'sk-dialog' },
    h('div', { class: 'sk-dialog-body' }, ...children),
  );
  el.addEventListener('close', () => el.remove());
  // Clicking the backdrop closes the dialog.
  el.addEventListener('click', (event) => {
    if (event.target === el) el.close();
  });
  document.body.append(el);
  el.showModal();
  return el;
}

function field(label: string, input: HTMLInputElement): HTMLElement {
  return h('label', { class: 'sk-field' }, label, input);
}

function linkRow(label: string, url: string, note: string): HTMLElement {
  const input = h('input', { value: url, readonly: true, 'aria-label': label });
  const copy = h(
    'button',
    {
      class: 'sk-button',
      type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(url);
          copy.lastChild!.textContent = 'Tersalin';
        } catch {
          input.select();
          copy.lastChild!.textContent = 'Salin manual';
        }
        setTimeout(() => (copy.lastChild!.textContent = 'Salin'), 2000);
      },
    },
    icon('copy'),
    h('span', {}, 'Salin'),
  );
  input.addEventListener('focus', () => input.select());
  return h(
    'div',
    { class: 'sk-field' },
    label,
    h('div', { class: 'sk-link-row' }, input, copy),
    h('p', { class: 'sk-note' }, note),
  );
}

export function openLocalShare(options: LocalShareOptions): void {
  const userName = h('input', {
    value: options.user.name,
    maxlength: MAX_USER_NAME,
    required: true,
  });
  const roomName = h('input', { placeholder: 'mis. Retro sprint 12', maxlength: MAX_ROOM_NAME });
  const error = h('p', { class: 'sk-error', hidden: true, role: 'alert' });
  const start = h('button', { class: 'sk-button primary', type: 'submit' }, 'Mulai sesi');
  const cancel = h('button', { class: 'sk-button', type: 'button' }, 'Batal');
  const form = h(
    'form',
    { class: 'sk-dialog-body', style: 'padding:0' },
    field('Nama kamu', userName),
    field('Nama papan (opsional)', roomName),
    error,
    h('div', { class: 'sk-dialog-actions' }, cancel, start),
  );
  const el = dialog(
    h('h2', {}, 'Kolaborasi langsung'),
    h(
      'p',
      {},
      'Gambar bersama secara realtime. Papan ini akan dipindah ke room baru di server, lalu kamu ' +
        'mendapat dua link: satu untuk mengedit dan satu untuk melihat saja. Siapa pun yang memegang ' +
        'link bisa masuk, jadi bagikan dengan orang yang kamu percaya.',
    ),
    form,
  );
  cancel.addEventListener('click', () => el.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    start.disabled = true;
    start.textContent = 'Membuat room…';
    error.hidden = true;
    try {
      await options.start(roomName.value, userName.value);
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : String(reason);
      error.hidden = false;
      start.disabled = false;
      start.textContent = 'Mulai sesi';
    }
  });
}

export function openRoomShare(options: RoomShareOptions): void {
  const links = knownLinks(options.roomId);
  const rows: HTMLElement[] = [];
  if (links.edit) {
    rows.push(
      linkRow(
        'Link edit',
        shareUrl(options.roomId, links.edit),
        'Siapa pun dengan link ini bisa menggambar dan menghapus isi papan.',
      ),
    );
  }
  if (links.view) {
    rows.push(
      linkRow(
        'Link lihat saja',
        shareUrl(options.roomId, links.view),
        'Bisa melihat, menggeser, dan mengekspor, tapi tidak mengubah papan.',
      ),
    );
  }
  if (!links.view && options.role === 'edit') {
    rows.push(h('p', { class: 'sk-note' }, 'Link lihat-saja hanya diketahui oleh pembuat room.'));
  }

  const peers = options.peers();
  const people = h(
    'p',
    {},
    peers.length > 1
      ? `${peers.length} orang di room ini: ${peers.map((p) => p.name).join(', ')}.`
      : 'Baru kamu di room ini. Bagikan link supaya orang lain bisa bergabung.',
  );
  const userName = h('input', { value: options.user.name, maxlength: MAX_USER_NAME });
  const save = h('button', { class: 'sk-button', type: 'button' }, 'Simpan nama');
  const leave = h(
    'button',
    { class: 'sk-button danger', type: 'button' },
    icon('exit'),
    'Keluar dari sesi',
  );
  const close = h('button', { class: 'sk-button primary', type: 'button' }, 'Selesai');

  const el = dialog(
    h('h2', {}, options.roomName),
    h(
      'p',
      {},
      options.role === 'edit'
        ? 'Kamu bisa mengedit papan ini.'
        : 'Kamu masuk dengan link lihat saja.',
    ),
    ...rows,
    people,
    h(
      'div',
      { class: 'sk-field' },
      'Nama kamu',
      h('div', { class: 'sk-link-row' }, userName, save),
    ),
    h('div', { class: 'sk-dialog-actions' }, leave, h('span', { class: 'sk-spacer' }), close),
  );
  save.addEventListener('click', () => options.rename(userName.value));
  leave.addEventListener('click', () => {
    if (confirm('Keluar dari sesi? Salinan papan tetap tersimpan di browser ini.')) options.leave();
  });
  close.addEventListener('click', () => el.close());
}
