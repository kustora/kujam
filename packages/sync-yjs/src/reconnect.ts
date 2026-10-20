/**
 * Exponential backoff reconnection manager and authentication error detection (BOARD-1509).
 *
 * @packageDocumentation
 */

import type { SyncErrorDetail, SyncStatus } from '@kujam/core';

/**
 * Options for configuring exponential backoff reconnection.
 *
 * @public
 */
export interface ReconnectOptions {
  /**
   * Initial delay before the first reconnection attempt in milliseconds.
   *
   * @defaultValue 1000
   */
  initialDelayMs?: number;

  /**
   * Maximum delay between reconnection attempts in milliseconds.
   *
   * @defaultValue 30000
   */
  maxDelayMs?: number;

  /**
   * Exponential factor applied to the delay on each subsequent attempt.
   *
   * @defaultValue 2
   */
  backoffFactor?: number;

  /**
   * Whether to add random jitter to the computed backoff delay.
   *
   * @defaultValue true
   */
  jitter?: boolean;

  /**
   * Maximum number of reconnection attempts before failing and stopping.
   *
   * @defaultValue Infinity
   */
  maxAttempts?: number;

  /**
   * Optional custom PRNG function returning a value in `[0, 1)` for deterministic jitter testing.
   *
   * @defaultValue Math.random
   */
  randomFn?: () => number;

  /**
   * Optional ratio of base delay applied as jitter (between 0 and 1).
   *
   * @defaultValue 0.25
   */
  jitterRatio?: number;
}

/**
 * Custom error class representing authentication or authorization failure during synchronization.
 *
 * @public
 */
export class SyncAuthError extends Error {
  /** Status or error code associated with the authentication failure. */
  readonly code: number | string;

  /** Constant classification reason. */
  readonly reason = 'auth' as const;

  constructor(message = 'Authentication failed', code: number | string = 401) {
    super(message);
    this.name = 'SyncAuthError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Computes backoff delay in milliseconds using exponential backoff with optional jitter.
 *
 * Formula: `Math.min(maxDelayMs, initialDelayMs * Math.pow(backoffFactor, attempt))` plus random jitter if enabled.
 *
 * @param attempt - 0-indexed attempt count.
 * @param options - Configuration options for backoff.
 * @returns Reconnection delay in milliseconds.
 *
 * @public
 */
export function calculateBackoffDelay(attempt: number, options?: ReconnectOptions): number {
  const initial = Math.max(0, options?.initialDelayMs ?? 1000);
  const max = Math.max(initial, options?.maxDelayMs ?? 30000);
  const factor = Math.max(1, options?.backoffFactor ?? 2);
  const jitter = options?.jitter ?? true;
  const randomFn = options?.randomFn ?? Math.random;
  const jitterRatio = options?.jitterRatio ?? 0.25;

  const safeAttempt = Math.max(0, attempt);
  const baseDelay = Math.min(max, initial * Math.pow(factor, safeAttempt));

  if (!jitter) {
    return baseDelay;
  }

  const jitterVal = randomFn() * Math.min(baseDelay * jitterRatio, 1000);
  return baseDelay + jitterVal;
}

/**
 * Determines whether an error is caused by authentication/authorization failure.
 *
 * Detects HTTP 401/403, WebSocket close codes 4401/4403, error names `AuthError` or `SyncAuthError`,
 * objects with `{ reason: 'auth' }`, or nested error/response properties.
 *
 * @param error - The error or rejection value to check.
 * @returns True if the error indicates authentication failure, false otherwise.
 *
 * @public
 */
export function isAuthError(error: unknown): boolean {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) {
    return false;
  }

  const obj = error as Record<string, unknown>;

  if (obj.reason === 'auth') {
    return true;
  }

  if (obj.name === 'AuthError' || obj.name === 'SyncAuthError') {
    return true;
  }

  const isAuthCode = (val: unknown): boolean => {
    if (val === 401 || val === 403 || val === 4401 || val === 4403) return true;
    if (typeof val === 'string') {
      const trimmed = val.trim().toUpperCase();
      if (
        trimmed === '401' ||
        trimmed === '403' ||
        trimmed === '4401' ||
        trimmed === '4403' ||
        trimmed === 'UNAUTHORIZED' ||
        trimmed === 'FORBIDDEN' ||
        trimmed === 'AUTH_FAILED' ||
        trimmed === 'ERR_AUTH'
      ) {
        return true;
      }
    }
    return false;
  };

  if (isAuthCode(obj.status) || isAuthCode(obj.statusCode) || isAuthCode(obj.code)) {
    return true;
  }

  if (isAuthCode(obj.closeCode)) {
    return true;
  }

  // Check nested error
  if (obj.error && typeof obj.error === 'object' && isAuthError(obj.error)) {
    return true;
  }

  // Check nested cause
  if (obj.cause && typeof obj.cause === 'object' && isAuthError(obj.cause)) {
    return true;
  }

  // Check nested response status (e.g. fetch or axios response)
  if (obj.response && typeof obj.response === 'object') {
    const resp = obj.response as Record<string, unknown>;
    if (isAuthCode(resp.status) || isAuthCode(resp.statusCode)) {
      return true;
    }
  }

  return false;
}

/**
 * Options for creating a ReconnectController.
 *
 * @public
 */
export interface ReconnectControllerOptions extends ReconnectOptions {
  /** Connection callback invoked to establish or re-establish connection. */
  connect: () => Promise<void> | void;

  /** Optional callback invoked when the connection status transitions. */
  onStatusChange?: (status: SyncStatus) => void;

  /** Optional callback invoked when a synchronization error occurs. */
  onError?: (detail: SyncErrorDetail) => void;

  /** Optional callback invoked when connection is established successfully. */
  onSuccess?: () => void;
}

/**
 * Controller managing automatic reconnection with exponential backoff and auth failure isolation (BOARD-1509).
 *
 * @public
 */
export class ReconnectController {
  private readonly options: ReconnectOptions;
  private readonly connectFn: () => Promise<void> | void;
  private readonly onStatusChange?: (status: SyncStatus) => void;
  private readonly onError?: (detail: SyncErrorDetail) => void;
  private readonly onSuccess?: () => void;

  private _attempts = 0;
  private _status: SyncStatus = 'offline';
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _connectingPromise: Promise<void> | null = null;
  private _destroyed = false;

  constructor(options: ReconnectControllerOptions) {
    this.options = options;
    this.connectFn = options.connect;
    this.onStatusChange = options.onStatusChange;
    this.onError = options.onError;
    this.onSuccess = options.onSuccess;
  }

  /**
   * Number of consecutive failed reconnection attempts since last successful connection.
   */
  get reconnectAttempts(): number {
    return this._attempts;
  }

  /**
   * Current connection status managed by the controller.
   */
  get status(): SyncStatus {
    return this._status;
  }

  /**
   * Whether a reconnection timer or in-flight connection is currently active.
   */
  get isReconnecting(): boolean {
    return this._timer !== null || this._connectingPromise !== null;
  }

  /**
   * Updates the internal status and triggers the status change callback.
   */
  setStatus(next: SyncStatus): void {
    if (this._status === next) return;
    this._status = next;
    this.onStatusChange?.(next);
  }

  /**
   * Clears any active reconnection timer without altering attempt counts.
   */
  private clearTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  /**
   * Triggers an immediate reconnection attempt, cancelling any pending scheduled timer.
   */
  async reconnect(): Promise<void> {
    if (this._destroyed) return;
    this.clearTimer();

    if (this._connectingPromise) {
      return this._connectingPromise;
    }

    this.setStatus('connecting');

    this._connectingPromise = (async () => {
      try {
        await Promise.resolve().then(() => this.connectFn());
        this.handleSuccess();
      } catch (err) {
        this.handleError(err);
      } finally {
        this._connectingPromise = null;
      }
    })();

    return this._connectingPromise;
  }

  /**
   * Cancels any pending scheduled reconnection timer and stops automatic retries.
   */
  cancelReconnect(): void {
    this.clearTimer();
  }

  /**
   * Resets the reconnection attempt counter and cancels any active timer.
   */
  reset(): void {
    this.clearTimer();
    this._attempts = 0;
  }

  /**
   * Handles an error encountered during connection or normal operation.
   *
   * Differentiates authentication errors from network errors:
   * - Auth errors transition to `'error'`, emit an auth error event, and cancel automatic backoff.
   * - Network errors transition to `'connecting'`, emit a network error event, and schedule exponential backoff.
   *
   * @param error - The error or rejection value.
   */
  handleError(error: unknown): void {
    if (this._destroyed) return;

    if (isAuthError(error)) {
      this.cancelReconnect();
      this.setStatus('error');
      const detail: SyncErrorDetail = {
        reason: 'auth',
        error,
        message:
          error instanceof Error
            ? error.message
            : 'Authentication failed during synchronization',
      };
      this.onError?.(detail);
      return;
    }

    const maxAttempts = this.options.maxAttempts ?? Infinity;
    const detail: SyncErrorDetail = {
      reason: 'network',
      error,
      message:
        error instanceof Error
          ? error.message
          : 'Network connection lost during synchronization',
    };
    this.onError?.(detail);

    if (this._attempts >= maxAttempts) {
      this.cancelReconnect();
      this.setStatus('error');
      return;
    }

    this.setStatus('connecting');
    const delay = calculateBackoffDelay(this._attempts, this.options);
    this._attempts++;

    this.clearTimer();
    this._timer = setTimeout(() => {
      this._timer = null;
      void this.reconnect();
    }, delay);
  }

  /**
   * Convenience method to report a connection drop (e.g. WebSocket abnormal close or offline event).
   *
   * @param error - Optional error causing the drop. Defaults to a generic network error.
   */
  handleConnectionDrop(error?: unknown): void {
    const err = error ?? new Error('Connection lost');
    this.handleError(err);
  }

  /**
   * Marks a connection attempt as succeeded, resetting attempt counts and setting status to `'synced'`.
   */
  handleSuccess(): void {
    this.clearTimer();
    this._attempts = 0;
    this.setStatus('synced');
    this.onSuccess?.();
  }

  /**
   * Destroys the controller and releases active timers.
   */
  destroy(): void {
    this._destroyed = true;
    this.clearTimer();
    this._connectingPromise = null;
  }
}

/**
 * Creates a ReconnectController instance.
 *
 * @param options - Configuration and callbacks.
 * @returns ReconnectController instance.
 *
 * @public
 */
export function createReconnectController(
  options: ReconnectControllerOptions,
): ReconnectController {
  return new ReconnectController(options);
}
