/**
 * Validation of presence (awareness) states received from peers (BOARD-2009, ADR-009 T2).
 *
 * Awareness is written by other clients and skips document validation, so every field is checked
 * here before the board, renderer, or UI sees it. Invalid fields are dropped one by one (the peer
 * stays visible); oversized values are capped. Display paths already avoid HTML (`textContent`,
 * canvas, CSSOM), so this guards against slow or broken rendering and impersonation, not XSS.
 */

import {
  DEFAULT_BOARD_LIMITS,
  sanitizeUrl,
  type PresenceLiveStroke,
  type PresencePeerState,
  type PresenceUser,
} from '@kujam/core';

/**
 * Bounds applied to presence states from peers.
 *
 * @public
 */
export interface PresenceLimits {
  /** Longest display name, in characters. Longer names are cut. @defaultValue 64 */
  readonly maxNameLength: number;
  /** Most element IDs kept from a peer's selection. @defaultValue 1000 */
  readonly maxSelection: number;
  /** Most points kept from a peer's live stroke. @defaultValue the board's `maxDrawPoints` (5,000) */
  readonly maxStrokePoints: number;
  /** Largest absolute board coordinate accepted for cursors, cameras, and stroke points. @defaultValue 1e7 */
  readonly maxCoordinate: number;
}

/** Default {@link PresenceLimits}. @public */
export const DEFAULT_PRESENCE_LIMITS: Readonly<PresenceLimits> = Object.freeze({
  maxNameLength: 64,
  maxSelection: 1000,
  maxStrokePoints: DEFAULT_BOARD_LIMITS.maxDrawPoints,
  maxCoordinate: 1e7,
});

const MAX_ID_LENGTH = 128;
const MAX_SHORT_STRING = 64;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const FALLBACK_COLOR = '#888888';
/** Avatars are shown as images: web URLs and raster data URIs only. */
const AVATAR_SCHEMES = ['https:', 'http:', 'data:'] as const;
// Control and bidi-override characters can hide or reorder text in labels.
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function finite(v: unknown, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
}

function shortString(v: unknown, max = MAX_SHORT_STRING): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;
}

function cleanName(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const name = Array.from(
    v
      .slice(0, max * 4)
      .replace(UNSAFE_TEXT, '')
      .trim(),
  )
    .slice(0, max)
    .join('');
  return name.length > 0 ? name : undefined;
}

function user(raw: unknown, fallbackId: string, limits: PresenceLimits): PresenceUser {
  const value = isRecord(raw) ? raw : {};
  const id =
    typeof value.id === 'string' || typeof value.id === 'number'
      ? shortString(String(value.id).trim(), MAX_ID_LENGTH)
      : undefined;
  const out: PresenceUser = {
    id: id ?? fallbackId,
    name: cleanName(value.name, limits.maxNameLength) ?? `User ${fallbackId}`,
    color:
      typeof value.color === 'string' && HEX_COLOR.test(value.color) ? value.color : FALLBACK_COLOR,
  };
  const avatar = sanitizeUrl(value.avatar, AVATAR_SCHEMES);
  if (avatar) out.avatar = avatar;
  return out;
}

function point(raw: unknown, max: number): { x: number; y: number } | undefined {
  if (!isRecord(raw) || !finite(raw.x, max) || !finite(raw.y, max)) return undefined;
  return { x: raw.x, y: raw.y };
}

function camera(raw: unknown, max: number): PresencePeerState['camera'] {
  if (!isRecord(raw) || !finite(raw.x, max) || !finite(raw.y, max)) return undefined;
  if (!finite(raw.zoom, 1000) || raw.zoom <= 0) return undefined;
  const out: NonNullable<PresencePeerState['camera']> = { x: raw.x, y: raw.y, zoom: raw.zoom };
  const vp = raw.viewport;
  if (
    isRecord(vp) &&
    finite(vp.width, 1e5) &&
    finite(vp.height, 1e5) &&
    vp.width >= 0 &&
    vp.height >= 0
  ) {
    return { ...out, viewport: { width: vp.width, height: vp.height } };
  }
  return out;
}

function selection(raw: unknown, max: number): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const id of raw) {
    if (out.length >= max) break;
    const s = shortString(id, MAX_ID_LENGTH);
    if (s) out.push(s);
  }
  return out;
}

function liveStroke(raw: unknown, limits: PresenceLimits): PresenceLiveStroke | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw) || !Array.isArray(raw.points)) return undefined;
  const thickness = raw.thickness;
  if (!finite(thickness, 1000) || thickness <= 0) return undefined;
  const color = shortString(raw.color);
  if (!color) return undefined;
  const points: number[][] = [];
  for (const p of raw.points.slice(0, limits.maxStrokePoints)) {
    if (
      !Array.isArray(p) ||
      !finite(p[0], limits.maxCoordinate) ||
      !finite(p[1], limits.maxCoordinate)
    ) {
      continue;
    }
    points.push(finite(p[2], 1) ? [p[0], p[1], p[2]] : [p[0], p[1]]);
  }
  const id = shortString(raw.id, MAX_ID_LENGTH);
  const brush = shortString(raw.brush);
  return {
    ...(id ? { id } : {}),
    points,
    color,
    thickness,
    ...(brush ? { brush } : {}),
  };
}

/**
 * Validates and caps a peer's raw awareness state into a {@link PresencePeerState}.
 * `fallbackId` names a peer that sent no usable user ID (its Yjs client ID).
 *
 * @public
 */
export function sanitizePresenceState(
  raw: Record<string, unknown>,
  fallbackId: string,
  limits: PresenceLimits = DEFAULT_PRESENCE_LIMITS,
): PresencePeerState {
  const max = limits.maxCoordinate;
  const state: PresencePeerState = { user: user(raw.user, fallbackId, limits) };
  if (raw.cursor === null) state.cursor = null;
  else {
    const cursor = point(raw.cursor, max);
    if (cursor) state.cursor = cursor;
  }
  const sel = selection(raw.selection, limits.maxSelection);
  if (sel) state.selection = sel;
  const cam = camera(raw.camera, max);
  if (cam) state.camera = cam;
  const tool = shortString(raw.tool);
  if (tool) state.tool = tool;
  const stroke = liveStroke(raw.activeStroke, limits);
  if (stroke !== undefined) state.activeStroke = stroke;
  // Extra metadata (the state is extensible) is kept when it is a small primitive.
  let extras = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN_KEYS.has(key) || key === '__proto__' || extras >= MAX_EXTRA_KEYS) continue;
    if (key.length > MAX_SHORT_STRING) continue;
    const keep =
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 256);
    if (keep) {
      state[key] = value;
      extras++;
    }
  }
  return state;
}

const KNOWN_KEYS = new Set(['user', 'cursor', 'selection', 'camera', 'tool', 'activeStroke']);
const MAX_EXTRA_KEYS = 16;
