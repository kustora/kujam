import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness.js';
import { createYjsPresence, DEFAULT_PRESENCE_LIMITS, sanitizePresenceState } from './index.js';

/** Sends `state` from a fresh peer to `target` and returns the peer's client ID. */
function sendFromPeer(target: Awareness, state: Record<string, unknown>): number {
  const peer = new Awareness(new Y.Doc());
  peer.setLocalState(state);
  applyAwarenessUpdate(target, encodeAwarenessUpdate(peer, [peer.clientID]), 'remote');
  return peer.clientID;
}

describe('BOARD-2009: presence states from peers', () => {
  it('keeps a well-formed state as is', () => {
    const state = sanitizePresenceState(
      {
        user: { id: 'u1', name: 'Sari', color: '#2563eb', avatar: 'https://example.com/a.png' },
        cursor: { x: 10, y: -20 },
        selection: ['a', 'b'],
        camera: { x: 1, y: 2, zoom: 1.5, viewport: { width: 800, height: 600 } },
        tool: 'draw',
        activeStroke: { id: 's1', points: [[0, 0, 0.5], [10, 10]], color: '#000000', thickness: 4, brush: 'pen' },
        mood: 'happy',
      },
      '42',
    );
    expect(state).toEqual({
      user: { id: 'u1', name: 'Sari', color: '#2563eb', avatar: 'https://example.com/a.png' },
      cursor: { x: 10, y: -20 },
      selection: ['a', 'b'],
      camera: { x: 1, y: 2, zoom: 1.5, viewport: { width: 800, height: 600 } },
      tool: 'draw',
      activeStroke: { id: 's1', points: [[0, 0, 0.5], [10, 10]], color: '#000000', thickness: 4, brush: 'pen' },
      mood: 'happy',
    });
  });

  it('caps and cleans hostile values field by field', () => {
    const state = sanitizePresenceState(
      {
        user: {
          id: 'x'.repeat(10_000),
          name: `‮evil\u0000${'n'.repeat(1_000_000)}`,
          color: 'url(https://tracker.example/pixel)',
          avatar: 'javascript:alert(1)',
        },
        cursor: { x: Number.NaN, y: 1 },
        selection: Array.from({ length: 100_000 }, (_, i) => `id${i}`),
        camera: { x: 0, y: 0, zoom: Number.POSITIVE_INFINITY },
        tool: { toString: () => 'select' },
        activeStroke: {
          points: Array.from({ length: 1_000_000 }, (_, i) => [i, i]),
          color: '#000000',
          thickness: 2,
        },
        blob: 'b'.repeat(100_000),
        __proto__: { polluted: true },
      },
      '7',
    );
    expect(state.user).toEqual({ id: '7', name: `evil${'n'.repeat(60)}`, color: '#888888' });
    expect(state.cursor).toBeUndefined();
    expect(state.selection).toHaveLength(DEFAULT_PRESENCE_LIMITS.maxSelection);
    expect(state.camera).toBeUndefined();
    expect(state.tool).toBeUndefined();
    expect(state.activeStroke?.points).toHaveLength(DEFAULT_PRESENCE_LIMITS.maxStrokePoints);
    expect(state.blob).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops a malformed live stroke but keeps the rest of the peer', () => {
    const state = sanitizePresenceState(
      { user: { id: 'u', name: 'A', color: '#fff' }, activeStroke: { points: 'nope', thickness: 1 } },
      '1',
    );
    expect(state.user.name).toBe('A');
    expect(state.activeStroke).toBeUndefined();
  });

  it('presence only ever exposes sanitized peer states, live strokes included', () => {
    const awareness = new Awareness(new Y.Doc());
    const presence = createYjsPresence({ awareness, limits: { maxStrokePoints: 100 } });
    const clientId = sendFromPeer(awareness, {
      user: { id: 'mallory', name: 'M'.repeat(5_000), color: 'red; background: url(x)' },
      cursor: { x: 1e12, y: 0 },
      activeStroke: {
        id: 'live',
        points: Array.from({ length: 50_000 }, (_, i) => [i % 500, i % 300]),
        color: '#e11d48',
        thickness: 3,
      },
    });

    const peer = presence.peers.get('mallory')!;
    expect(peer.user.name).toHaveLength(DEFAULT_PRESENCE_LIMITS.maxNameLength);
    expect(peer.user.color).toBe('#888888');
    expect(peer.cursor).toBeUndefined();
    expect(presence.getLiveStrokes().get('mallory')?.points).toHaveLength(100);
    expect(clientId).toBeGreaterThan(0);
    presence.destroy();
  });

  it('a peer without a usable ID is keyed by its client ID', () => {
    const awareness = new Awareness(new Y.Doc());
    const presence = createYjsPresence({ awareness });
    const clientId = sendFromPeer(awareness, { user: { id: { evil: true }, name: 'X' } });
    expect(presence.peers.get(String(clientId))?.user).toMatchObject({ id: String(clientId), name: 'X' });
    presence.destroy();
  });
});
