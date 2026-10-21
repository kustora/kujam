/**
 * Reference extraction for building card placement indices on the server (BOARD-1802).
 *
 * Runs in pure Node.js 20 without DOM or `window` dependencies.
 */

import {
  createElementRegistry,
  type AnyElementDefinition,
  type BoardDocument,
  type BoardRecord,
  type ElementRecord,
  type ElementRegistry,
  type PluginDefinition,
} from '@kujam/core';
import { updateToDocument } from '@kujam/sync-yjs';

/**
 * Entity placement reference extracted from a board document (BOARD-1802).
 *
 * Used by server workers to populate card placement tables (e.g. `board_card_placements`).
 *
 * @public
 */
export interface CardPlacementReference {
  /** Resolver handling this entity type (e.g. `'card'`, `'task'`, `'contact'`). */
  readonly resolver: string;
  /** Unique entity ID within the resolver domain. */
  readonly id: string;
  /** Element ID on the board canvas. */
  readonly elementId: string;
  /** Page ID where the element resides. */
  readonly pageId: string;
  /** Enclosing frame element ID, if the element is placed inside a frame. */
  readonly frameId?: string;
}

/**
 * Options for {@link extractReferences}.
 *
 * @public
 */
export interface ExtractReferencesOptions {
  /** Element type registry containing element definitions. */
  readonly registry?: ElementRegistry;
  /** Plugins providing element definitions with `references` contracts. */
  readonly plugins?: readonly PluginDefinition[];
  /** Explicit element definitions with `references` contracts. */
  readonly elements?: readonly AnyElementDefinition[];
  /** Filter references to only these element types. */
  readonly types?: readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Extracts entity references from a board document or binary Yjs state update (BOARD-1802).
 *
 * Inspects element definitions for the `references(el)` contract method. Also extracts
 * references from common element props patterns (e.g. `cardId`, `references`, `reference`, `resolver` + `refId`).
 *
 * Identifies whether each element is enclosed within a frame container (`frameId`).
 * Designed to run with low overhead in server `onChange` hooks or queue workers.
 *
 * @param docOrUpdate - Canonical board document or binary Yjs update bytes.
 * @param options - Extraction options including registry, plugins, or type filter.
 * @returns Array of extracted card placement references.
 * @public
 */
export function extractReferences(
  docOrUpdate: BoardDocument | Uint8Array,
  options?: ExtractReferencesOptions,
): readonly CardPlacementReference[] {
  let doc: BoardDocument;

  if (docOrUpdate instanceof Uint8Array) {
    try {
      doc = updateToDocument(docOrUpdate);
    } catch {
      return Object.freeze([]);
    }
  } else {
    doc = docOrUpdate;
  }

  if (!isPlainObject(doc) || !isPlainObject(doc.records)) {
    return Object.freeze([]);
  }

  // Resolve registry if plugins or definitions were provided
  let registry = options?.registry;
  if (!registry && (options?.plugins || options?.elements)) {
    const definitions: AnyElementDefinition[] = [];
    if (options?.elements) {
      definitions.push(...options.elements);
    }
    if (options?.plugins) {
      for (const plugin of options.plugins) {
        if (plugin.elements) {
          definitions.push(...plugin.elements);
        }
      }
    }
    registry = createElementRegistry(definitions);
  }

  // Frame memoization: parentId -> enclosing frameId (or null if none)
  const frameMemo = new Map<string, string | null>();

  function getEnclosingFrameId(startParentId: string | null): string | undefined {
    if (!startParentId) return undefined;
    if (frameMemo.has(startParentId)) {
      const cached = frameMemo.get(startParentId);
      return cached === null ? undefined : cached;
    }

    const path: string[] = [];
    const visited = new Set<string>();
    let currentId: string | null = startParentId;
    let foundFrameId: string | null = null;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      path.push(currentId);

      if (frameMemo.has(currentId)) {
        foundFrameId = frameMemo.get(currentId)!;
        break;
      }

      const rec: BoardRecord | undefined = doc.records[currentId];
      if (!rec || rec.kind !== 'element') {
        break;
      }

      if (rec.type === 'frame') {
        foundFrameId = rec.id;
        break;
      }

      currentId = rec.parentId;
    }

    for (const id of path) {
      frameMemo.set(id, foundFrameId);
    }

    return foundFrameId === null ? undefined : foundFrameId;
  }

  const results: CardPlacementReference[] = [];
  const typeFilter = options?.types ? new Set(options.types) : null;

  for (const record of Object.values(doc.records)) {
    if (!record || record.kind !== 'element') continue;
    const el = record as ElementRecord;

    if (typeFilter && !typeFilter.has(el.type)) {
      continue;
    }

    const frameId = getEnclosingFrameId(el.parentId);
    const rawRefs: { resolver: string; id: string }[] = [];

    // 1. Check custom element definition contract: references(el)
    const def = registry?.get(el.type);
    if (def?.references) {
      try {
        const declared = def.references(el);
        if (Array.isArray(declared)) {
          for (const item of declared) {
            if (
              item &&
              typeof item.resolver === 'string' &&
              typeof item.id === 'string' &&
              item.resolver.length > 0 &&
              item.id.length > 0
            ) {
              rawRefs.push({ resolver: item.resolver, id: item.id });
            }
          }
        }
      } catch {
        // Resilient against errors in custom definition callbacks
      }
    }

    // 2. Check common props/fields patterns
    const props = isPlainObject(el.props) ? el.props : undefined;
    if (props) {
      // Pattern A: props.references = [{ resolver, id }, ...]
      if (Array.isArray(props.references)) {
        for (const item of props.references) {
          if (
            isPlainObject(item) &&
            typeof item.resolver === 'string' &&
            typeof item.id === 'string' &&
            item.resolver.length > 0 &&
            item.id.length > 0
          ) {
            rawRefs.push({ resolver: item.resolver, id: item.id });
          }
        }
      }

      // Pattern B: props.reference = { resolver, id }
      if (
        isPlainObject(props.reference) &&
        typeof props.reference.resolver === 'string' &&
        typeof props.reference.id === 'string' &&
        props.reference.resolver.length > 0 &&
        props.reference.id.length > 0
      ) {
        rawRefs.push({
          resolver: props.reference.resolver,
          id: props.reference.id,
        });
      }

      // Pattern C: props.cardId or props.card_id
      const cardId = props.cardId ?? props.card_id;
      if (typeof cardId === 'string' && cardId.length > 0) {
        rawRefs.push({ resolver: 'card', id: cardId });
      } else if (typeof cardId === 'number' && Number.isFinite(cardId)) {
        rawRefs.push({ resolver: 'card', id: String(cardId) });
      }

      // Pattern D: props.resolver + (props.refId | props.id | props.entityId)
      if (typeof props.resolver === 'string' && props.resolver.length > 0) {
        const refId = props.refId ?? props.id ?? props.entityId;
        if (typeof refId === 'string' && refId.length > 0) {
          rawRefs.push({ resolver: props.resolver, id: refId });
        } else if (typeof refId === 'number' && Number.isFinite(refId)) {
          rawRefs.push({ resolver: props.resolver, id: String(refId) });
        }
      }
    }

    // 3. Check common meta patterns
    const meta = isPlainObject(el.meta) ? el.meta : undefined;
    if (meta && Array.isArray(meta.references)) {
      for (const item of meta.references) {
        if (
          isPlainObject(item) &&
          typeof item.resolver === 'string' &&
          typeof item.id === 'string' &&
          item.resolver.length > 0 &&
          item.id.length > 0
        ) {
          rawRefs.push({ resolver: item.resolver, id: item.id });
        }
      }
    }

    // Deduplicate references per element
    const seen = new Set<string>();
    for (const ref of rawRefs) {
      const key = `${ref.resolver}:${ref.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          resolver: ref.resolver,
          id: ref.id,
          elementId: el.id,
          pageId: el.pageId,
          ...(frameId !== undefined ? { frameId } : {}),
        });
      }
    }
  }

  return Object.freeze(results);
}
