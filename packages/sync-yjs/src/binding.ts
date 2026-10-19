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
    for (const [key, val] of Object.entries(props)) {
      if (val !== undefined) {
        yProps.set(key, val);
      }
    }
    yMap.set('props', yProps);
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
