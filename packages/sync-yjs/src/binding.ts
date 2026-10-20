/**
 * Yjs CRDT data binding utilities and record conversions (BOARD-1502).
 *
 * @packageDocumentation
 */

import * as Y from 'yjs';
import type { BoardRecord } from '@kujam/core';

/**
 * Validates whether an unknown value is a structurally valid {@link BoardRecord}.
 *
 * Enforces non-empty identifiers, valid record kinds, finite numbers, and required properties.
 *
 * @param value - Value to validate.
 * @returns True if the value conforms to {@link BoardRecord}.
 * @public
 */
export function isValidBoardRecord(value: unknown): value is BoardRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== 'string' || rec.id.trim() === '') {
    return false;
  }
  if (typeof rec.kind !== 'string') {
    return false;
  }

  switch (rec.kind) {
    case 'element': {
      if (typeof rec.type !== 'string' || rec.type.trim() === '') return false;
      if (typeof rec.pageId !== 'string' || rec.pageId.trim() === '') return false;
      if (rec.parentId !== null && typeof rec.parentId !== 'string') return false;
      if (typeof rec.index !== 'string' || rec.index.trim() === '') return false;
      if (typeof rec.x !== 'number' || !Number.isFinite(rec.x)) return false;
      if (typeof rec.y !== 'number' || !Number.isFinite(rec.y)) return false;
      if (typeof rec.w !== 'number' || !Number.isFinite(rec.w)) return false;
      if (typeof rec.h !== 'number' || !Number.isFinite(rec.h)) return false;
      if (typeof rec.rotation !== 'number' || !Number.isFinite(rec.rotation)) return false;
      if (typeof rec.locked !== 'boolean') return false;
      if (typeof rec.opacity !== 'number' || !Number.isFinite(rec.opacity)) return false;
      if (typeof rec.props !== 'object' || rec.props === null || Array.isArray(rec.props)) {
        return false;
      }
      if (rec.typeVersion !== undefined && (typeof rec.typeVersion !== 'number' || !Number.isFinite(rec.typeVersion))) {
        return false;
      }
      if (
        rec.meta !== undefined &&
        (typeof rec.meta !== 'object' || rec.meta === null || Array.isArray(rec.meta))
      ) {
        return false;
      }
      return true;
    }

    case 'binding': {
      if (typeof rec.fromId !== 'string' || rec.fromId.trim() === '') return false;
      if (typeof rec.toId !== 'string' || rec.toId.trim() === '') return false;
      if (
        typeof rec.anchor !== 'object' ||
        rec.anchor === null ||
        Array.isArray(rec.anchor)
      ) {
        return false;
      }
      const anchor = rec.anchor as Record<string, unknown>;
      if (typeof anchor.x !== 'number' || !Number.isFinite(anchor.x)) return false;
      if (typeof anchor.y !== 'number' || !Number.isFinite(anchor.y)) return false;
      return true;
    }

    case 'page': {
      if (typeof rec.name !== 'string') return false;
      if (typeof rec.index !== 'string' || rec.index.trim() === '') return false;
      if (
        rec.meta !== undefined &&
        (typeof rec.meta !== 'object' || rec.meta === null || Array.isArray(rec.meta))
      ) {
        return false;
      }
      return true;
    }

    case 'asset': {
      if (typeof rec.mimeType !== 'string' || rec.mimeType.trim() === '') return false;
      if (typeof rec.w !== 'number' || !Number.isFinite(rec.w)) return false;
      if (typeof rec.h !== 'number' || !Number.isFinite(rec.h)) return false;
      if (
        rec.meta !== undefined &&
        (typeof rec.meta !== 'object' || rec.meta === null || Array.isArray(rec.meta))
      ) {
        return false;
      }
      return true;
    }

    default:
      return false;
  }
}

/**
 * Synchronizes a rich text Delta array into a Y.Text instance using character-level diffing.
 *
 * @public
 */
export function syncRichTextToYText(delta: unknown[], yText: Y.Text): void {
  const targetOps = delta as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>;
  const targetStr = targetOps.map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');
  const curStr = yText.toString();

  if (curStr === targetStr && JSON.stringify(yText.toDelta()) === JSON.stringify(delta)) {
    return;
  }

  if (yText.length === 0) {
    yText.applyDelta(targetOps as never);
    return;
  }

  let prefix = 0;
  while (prefix < curStr.length && prefix < targetStr.length && curStr[prefix] === targetStr[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < curStr.length - prefix &&
    suffix < targetStr.length - prefix &&
    curStr[curStr.length - 1 - suffix] === targetStr[targetStr.length - 1 - suffix]
  ) {
    suffix++;
  }

  const deleteCount = curStr.length - prefix - suffix;
  if (deleteCount > 0) {
    yText.delete(prefix, deleteCount);
  }

  const insertEnd = targetStr.length - suffix;
  if (insertEnd > prefix) {
    let charPos = 0;
    let curInsertOffset = 0;
    for (const op of targetOps) {
      const text = typeof op.insert === 'string' ? op.insert : '';
      const opStart = charPos;
      const opEnd = charPos + text.length;
      charPos = opEnd;

      const sliceStart = Math.max(prefix, opStart);
      const sliceEnd = Math.min(insertEnd, opEnd);
      if (sliceEnd > sliceStart) {
        const sliceText = text.slice(sliceStart - opStart, sliceEnd - opStart);
        yText.insert(prefix + curInsertOffset, sliceText, op.attributes || {});
        curInsertOffset += sliceText.length;
      }
    }
  }

  // Synchronize formatting attributes across the text
  let pos = 0;
  for (const op of targetOps) {
    const text = typeof op.insert === 'string' ? op.insert : '';
    const len = text.length;
    if (len > 0) {
      yText.format(pos, len, op.attributes || {});
      pos += len;
    }
  }
}

function isRichTextDelta(val: unknown): val is Array<{ insert: string; attributes?: Record<string, unknown> }> {
  return Array.isArray(val) && val.length > 0 && typeof (val[0] as { insert?: unknown })?.insert === 'string';
}

function normalizeRichTextDelta(delta: Array<{ insert?: unknown; attributes?: Record<string, unknown> }>): unknown[] {
  if (delta.length === 0) {
    return [{ insert: '\n' }];
  }
  const last = delta[delta.length - 1];
  if (last && typeof last.insert === 'string' && !last.insert.endsWith('\n')) {
    return [...delta.slice(0, -1), { ...last, insert: last.insert + '\n' }];
  }
  return delta;
}

/**
 * Synchronizes a record's properties dictionary into a nested `Y.Map`
 * so concurrent property updates can merge independently.
 */
function syncPropsToYMap(props: Record<string, unknown>, yMap: Y.Map<unknown>): void {
  const existingProps = yMap.doc !== null ? yMap.get('props') : undefined;
  if (existingProps instanceof Y.Map && existingProps.doc !== null) {
    const existingKeys = Array.from(existingProps.keys());
    for (const key of existingKeys) {
      if (!(key in props) || props[key] === undefined) {
        existingProps.delete(key);
      }
    }
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined) continue;

      if ((key === 'text' || key === 'label') && isRichTextDelta(val)) {
        const curText = existingProps.get(key);
        if (curText instanceof Y.Text && curText.doc !== null) {
          syncRichTextToYText(val, curText);
        } else {
          const yText = new Y.Text();
          existingProps.set(key, yText);
          syncRichTextToYText(val, yText);
        }
        continue;
      }

      const cur = existingProps.get(key);
      if (typeof val === 'object' && val !== null) {
        if (JSON.stringify(cur) !== JSON.stringify(val)) {
          existingProps.set(key, val);
        }
      } else if (cur !== val) {
        existingProps.set(key, val);
      }
    }
  } else {
    const yProps = new Y.Map<unknown>();
    yMap.set('props', yProps);
    for (const [key, val] of Object.entries(props)) {
      if (val !== undefined) {
        if ((key === 'text' || key === 'label') && isRichTextDelta(val)) {
          const yText = new Y.Text();
          yProps.set(key, yText);
          syncRichTextToYText(val, yText);
        } else {
          yProps.set(key, val);
        }
      }
    }
  }
}

/**
 * Writes or updates all fields of a {@link BoardRecord} into a target `Y.Map`.
 *
 * For element records, the `props` dictionary is stored as a nested `Y.Map` so concurrent
 * property modifications merge at the individual property level.
 *
 * @param record - Board record to serialize.
 * @param yMap - Target Y.Map instance to populate.
 * @public
 */
export function recordToYMap(record: BoardRecord, yMap: Y.Map<unknown>): void {
  const recObj = record as unknown as Record<string, unknown>;

  // Delete removed fields from the Y.Map if attached to a doc
  if (yMap.doc !== null) {
    for (const key of Array.from(yMap.keys())) {
      if (!(key in recObj) || recObj[key] === undefined) {
        yMap.delete(key);
      }
    }
  }

  // Populate/update fields
  for (const [key, value] of Object.entries(recObj)) {
    if (value === undefined) continue;

    if (key === 'props' && record.kind === 'element') {
      if (typeof value === 'object' && value !== null) {
        syncPropsToYMap(value as Record<string, unknown>, yMap);
      } else {
        yMap.set('props', value);
      }
    } else {
      if (yMap.doc !== null) {
        const cur = yMap.get(key);
        if (typeof value === 'object' && value !== null) {
          if (JSON.stringify(cur) !== JSON.stringify(value)) {
            yMap.set(key, value);
          }
        } else if (cur !== value) {
          yMap.set(key, value);
        }
      } else {
        yMap.set(key, value);
      }
    }
  }
}

/**
 * Deserializes a `Y.Map` into a valid {@link BoardRecord}.
 *
 * Converts nested `props` maps into plain JavaScript objects and ensures required
 * fields and finite numbers are present.
 *
 * @param yMap - Y.Map containing record fields.
 * @returns Parsed BoardRecord, or `null` if the data is malformed or invalid.
 * @public
 */
export function yMapToRecord(yMap: Y.Map<unknown>): BoardRecord | null {
  if (yMap.doc === null) {
    return null;
  }

  const raw = yMap.toJSON() as Record<string, unknown>;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  // Handle nested Y.Text in props
  const propsMap = yMap.get('props');
  if (propsMap instanceof Y.Map) {
    const rawProps = (raw.props && typeof raw.props === 'object' && !Array.isArray(raw.props)
      ? { ...(raw.props as Record<string, unknown>) }
      : {}) as Record<string, unknown>;

    for (const key of propsMap.keys()) {
      const val = propsMap.get(key);
      if (val instanceof Y.Text) {
        rawProps[key] = normalizeRichTextDelta(val.toDelta());
      }
    }
    raw.props = rawProps;
  }

  // Supply default meta if omitted
  if (raw.kind === 'element' || raw.kind === 'page' || raw.kind === 'asset') {
    if (!raw.meta || typeof raw.meta !== 'object' || Array.isArray(raw.meta)) {
      raw.meta = {};
    }
  }

  if (!isValidBoardRecord(raw)) {
    return null;
  }

  return raw as BoardRecord;
}
