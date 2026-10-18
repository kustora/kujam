/**
 * Remembered style per tool (BOARD-1108).
 *
 * Session state, like the camera and the selection: not part of the document, never saved, never
 * in undo history, kept across `loadDocument`, and allowed on `readOnly` boards. Core does not know
 * what the keys mean; creation tools read their style when they create an element, and the UI or
 * element style actions write the last style chosen.
 */

/**
 * A single style value, for example a color key, a thickness, or a brush ID.
 *
 * @beta
 */
export type ToolStyleValue = string | number | boolean;

/**
 * Style of one tool: a frozen map from a style key (usually an element prop name such as `color`)
 * to its value.
 *
 * @beta
 */
export type ToolStyle = Readonly<Record<string, ToolStyleValue>>;

/**
 * Patch for {@link ToolStyles.set}: values replace the old ones, `undefined` removes a key.
 *
 * @beta
 */
export type ToolStylePatch = Readonly<Record<string, ToolStyleValue | undefined>>;

/**
 * Payload of the `tool-style` event: emitted only when a tool's style actually changes.
 *
 * @beta
 */
export interface ToolStyleEvent {
  /** Tool (or style scope) whose style changed. */
  readonly toolId: string;
  readonly style: ToolStyle;
  readonly previous: ToolStyle;
}

/**
 * Remembered style per tool (`board.toolStyles`, BOARD-1108).
 *
 * Keys are tool IDs; tools that are variants of one another may share a key (the built-in shape
 * tools all use `geo`). Values are not checked against any element schema: tools must ignore
 * values they cannot use.
 *
 * @beta
 */
export interface ToolStyles {
  /** Style of a tool, frozen; an empty object when nothing was set. Same object until it changes. */
  get(toolId: string): ToolStyle;
  /**
   * Merges `patch` into the tool's style and emits a `tool-style` event when anything changed.
   *
   * @throws `TypeError` when `toolId` is not a non-empty string, `patch` is not an object, or a
   *   value is not a string, a finite number, a boolean, or `undefined` (the style is unchanged).
   */
  set(toolId: string, patch: ToolStylePatch): void;
}

/** @internal */
export interface ToolStylesRuntime {
  readonly api: ToolStyles;
  clear(): void;
}

const EMPTY: ToolStyle = Object.freeze({});

function isStyleValue(value: unknown): value is ToolStyleValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/** @internal */
export function createToolStyles(onChange: (event: ToolStyleEvent) => void): ToolStylesRuntime {
  const byTool = new Map<string, ToolStyle>();

  function assertToolId(toolId: unknown): asserts toolId is string {
    if (typeof toolId !== 'string' || toolId.length === 0) {
      throw new TypeError('ID tool pada toolStyles wajib berupa string tidak kosong.');
    }
  }

  const api: ToolStyles = {
    get(toolId) {
      assertToolId(toolId);
      return byTool.get(toolId) ?? EMPTY;
    },
    set(toolId, patch) {
      assertToolId(toolId);
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        throw new TypeError('Patch gaya tool wajib berupa objek.');
      }
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined && !isStyleValue(value)) {
          throw new TypeError(
            `Gaya "${key}" wajib berupa string, angka berhingga, boolean, atau undefined.`,
          );
        }
      }
      const previous = byTool.get(toolId) ?? EMPTY;
      const next: Record<string, ToolStyleValue> = { ...previous };
      let changed = false;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
          if (Object.hasOwn(next, key)) {
            delete next[key];
            changed = true;
          }
        } else if (next[key] !== value) {
          // `defineProperty` keeps keys such as `__proto__` as own keys.
          Object.defineProperty(next, key, {
            value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
          changed = true;
        }
      }
      if (!changed) return;
      const style = Object.freeze(next);
      byTool.set(toolId, style);
      onChange(Object.freeze({ toolId, style, previous }));
    },
  };

  return { api, clear: () => byTool.clear() };
}
