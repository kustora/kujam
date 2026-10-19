/**
 * Runtime deprecation warning helper (BOARD-2301).
 *
 * Emits a `console.warn` at most once per unique message in development mode.
 * Safe in Node, browsers, and Web Workers without relying on DOM or Node type declarations.
 */

const warnedMessages = new Set<string>();

interface RuntimeGlobals {
  readonly __KUJAM_DEV__?: unknown;
  readonly process?: {
    readonly env?: {
      readonly NODE_ENV?: string;
    };
  };
  readonly console?: {
    readonly warn?: (...args: unknown[]) => void;
  };
}

/**
 * Checks whether the current runtime environment is in development mode.
 *
 * Resolution order:
 * 1. Explicit boolean `globalThis.__KUJAM_DEV__` override.
 * 2. `globalThis.process?.env?.NODE_ENV !== 'production'` when `NODE_ENV` is defined.
 * 3. Defaults to `true` for unbundled ESM environments without `process.env`.
 *
 * @internal
 */
export function isDevelopmentMode(): boolean {
  try {
    const g = globalThis as unknown as RuntimeGlobals;
    if (typeof g.__KUJAM_DEV__ === 'boolean') {
      return g.__KUJAM_DEV__;
    }
    const nodeEnv = g.process?.env?.NODE_ENV;
    if (typeof nodeEnv === 'string') {
      return nodeEnv !== 'production';
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Emits a deprecation warning to `console.warn` at most once per unique `message`
 * when running in development mode. No-op in production mode.
 *
 * Per the `@kujam/*` API deprecation policy (BOARD-2301), any deprecated public API
 * must call `deprecate(message)` and carry a `@deprecated` TSDoc tag for at least
 * one minor release before removal.
 *
 * @param message - Actionable deprecation notice describing the replacement API and target removal release.
 * @public
 */
export function deprecate(message: string): void {
  if (!isDevelopmentMode()) return;
  if (warnedMessages.has(message)) return;
  warnedMessages.add(message);

  try {
    const sink = (globalThis as unknown as RuntimeGlobals).console;
    if (typeof sink?.warn === 'function') {
      const formatted = message.startsWith('[@kujam]')
        ? message
        : `[@kujam] Deprecated: ${message}`;
      sink.warn(formatted);
    }
  } catch {
    // Ignore errors from restricted or broken console implementations.
  }
}

/**
 * Clears the internal set of emitted deprecation warnings.
 * Intended for unit tests verifying warn-once behavior.
 *
 * @internal
 */
export function resetDeprecationWarnings(): void {
  warnedMessages.clear();
}
