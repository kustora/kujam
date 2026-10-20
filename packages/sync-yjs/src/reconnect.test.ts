import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoard, type SyncErrorDetail } from '@kujam/core';
import {
  calculateBackoffDelay,
  createReconnectController,
  createYjsSyncAdapter,
  isAuthError,
  ReconnectController,
  SyncAuthError,
  type ReconnectOptions,
} from './index.js';

describe('BOARD-1509: Reconnection, exponential backoff, and auth error isolation', () => {
  describe('calculateBackoffDelay', () => {
    it('computes exact exponential backoff without jitter', () => {
      const opts: ReconnectOptions = { jitter: false };

      expect(calculateBackoffDelay(0, opts)).toBe(1000);
      expect(calculateBackoffDelay(1, opts)).toBe(2000);
      expect(calculateBackoffDelay(2, opts)).toBe(4000);
      expect(calculateBackoffDelay(3, opts)).toBe(8000);
      expect(calculateBackoffDelay(4, opts)).toBe(16000);
      expect(calculateBackoffDelay(5, opts)).toBe(30000); // capped at maxDelayMs: 30000
      expect(calculateBackoffDelay(10, opts)).toBe(30000);
    });

    it('respects custom initialDelayMs, maxDelayMs, and backoffFactor', () => {
      const opts: ReconnectOptions = {
        initialDelayMs: 500,
        maxDelayMs: 4000,
        backoffFactor: 3,
        jitter: false,
      };

      expect(calculateBackoffDelay(0, opts)).toBe(500);
      expect(calculateBackoffDelay(1, opts)).toBe(1500);
      expect(calculateBackoffDelay(2, opts)).toBe(4000); // capped
      expect(calculateBackoffDelay(3, opts)).toBe(4000);
    });

    it('clamps negative attempt indices to 0', () => {
      const opts: ReconnectOptions = { jitter: false };
      expect(calculateBackoffDelay(-1, opts)).toBe(1000);
      expect(calculateBackoffDelay(-5, opts)).toBe(1000);
    });

    it('adds deterministic jitter when jitter is enabled', () => {
      const baseDelay = calculateBackoffDelay(0, { jitter: false });

      // With randomFn returning 0, jitter added is 0
      const delayNoJitter = calculateBackoffDelay(0, {
        jitter: true,
        randomFn: () => 0,
      });
      expect(delayNoJitter).toBe(baseDelay);

      // With randomFn returning 0.5
      const delayHalfJitter = calculateBackoffDelay(0, {
        jitter: true,
        randomFn: () => 0.5,
      });
      expect(delayHalfJitter).toBeGreaterThan(baseDelay);

      // With randomFn returning 1.0 (approaching 1)
      const delayFullJitter = calculateBackoffDelay(0, {
        jitter: true,
        randomFn: () => 1.0,
      });
      expect(delayFullJitter).toBeGreaterThan(delayHalfJitter);
    });
  });

  describe('isAuthError', () => {
    it('detects HTTP status codes 401 and 403 as numbers and strings', () => {
      expect(isAuthError({ status: 401 })).toBe(true);
      expect(isAuthError({ status: 403 })).toBe(true);
      expect(isAuthError({ status: '401' })).toBe(true);
      expect(isAuthError({ status: '403' })).toBe(true);
      expect(isAuthError({ statusCode: 401 })).toBe(true);
      expect(isAuthError({ statusCode: 403 })).toBe(true);
      expect(isAuthError({ code: 401 })).toBe(true);
      expect(isAuthError({ code: 403 })).toBe(true);
      expect(isAuthError({ code: 'UNAUTHORIZED' })).toBe(true);
      expect(isAuthError({ code: 'FORBIDDEN' })).toBe(true);
    });

    it('detects WebSocket authentication close codes 4401 and 4403', () => {
      expect(isAuthError({ code: 4401 })).toBe(true);
      expect(isAuthError({ code: 4403 })).toBe(true);
      expect(isAuthError({ code: '4401' })).toBe(true);
      expect(isAuthError({ closeCode: 4401 })).toBe(true);
      expect(isAuthError({ closeCode: 4403 })).toBe(true);
    });

    it('detects error names AuthError and SyncAuthError and SyncAuthError class instances', () => {
      const authErr = new Error('Session expired');
      authErr.name = 'AuthError';
      expect(isAuthError(authErr)).toBe(true);

      const syncAuthErr = new Error('Token revoked');
      syncAuthErr.name = 'SyncAuthError';
      expect(isAuthError(syncAuthErr)).toBe(true);

      const customAuth = new SyncAuthError('Forbidden', 403);
      expect(isAuthError(customAuth)).toBe(true);
      expect(customAuth.reason).toBe('auth');
      expect(customAuth.code).toBe(403);
    });

    it('detects explicit reason: "auth" property', () => {
      expect(isAuthError({ reason: 'auth' })).toBe(true);
      expect(isAuthError({ reason: 'auth', message: 'Invalid credentials' })).toBe(true);
    });

    it('detects nested response, error, and cause properties', () => {
      expect(isAuthError({ response: { status: 401 } })).toBe(true);
      expect(isAuthError({ response: { statusCode: 403 } })).toBe(true);
      expect(isAuthError({ error: { code: 4401 } })).toBe(true);
      expect(isAuthError({ error: { reason: 'auth' } })).toBe(true);
      expect(isAuthError({ cause: new SyncAuthError('Unauthorized', 401) })).toBe(true);
    });

    it('returns false for network errors, abnormal closes, server errors, and non-auth objects', () => {
      expect(isAuthError(null)).toBe(false);
      expect(isAuthError(undefined)).toBe(false);
      expect(isAuthError('some error string')).toBe(false);
      expect(isAuthError(401)).toBe(false);
      expect(isAuthError(new Error('Network timeout'))).toBe(false);
      expect(isAuthError({ code: 1006 })).toBe(false); // abnormal websocket closure is network drop
      expect(isAuthError({ code: 'ECONNRESET' })).toBe(false);
      expect(isAuthError({ code: 'ETIMEDOUT' })).toBe(false);
      expect(isAuthError({ status: 500 })).toBe(false);
      expect(isAuthError({ status: 502 })).toBe(false);
      expect(isAuthError({ reason: 'network' })).toBe(false);
    });
  });

  describe('ReconnectController standalone', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('initializes with default status offline and 0 attempts', () => {
      const connectFn = vi.fn();
      const controller = createReconnectController({ connect: connectFn });

      expect(controller.status).toBe('offline');
      expect(controller.reconnectAttempts).toBe(0);
      expect(controller.isReconnecting).toBe(false);
    });

    it('transitions to synced and resets attempts on successful connection', async () => {
      const connectFn = vi.fn().mockResolvedValue(undefined);
      const onStatusChange = vi.fn();
      const onSuccess = vi.fn();

      const controller = new ReconnectController({
        connect: connectFn,
        onStatusChange,
        onSuccess,
      });

      await controller.reconnect();

      expect(connectFn).toHaveBeenCalledTimes(1);
      expect(controller.status).toBe('synced');
      expect(controller.reconnectAttempts).toBe(0);
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onStatusChange).toHaveBeenCalledWith('connecting');
      expect(onStatusChange).toHaveBeenCalledWith('synced');
    });

    it('schedules retry with exponential backoff on network error', async () => {
      let failCount = 0;
      const connectFn = vi.fn().mockImplementation(async () => {
        if (failCount < 2) {
          failCount++;
          throw new Error('Connection refused');
        }
      });
      const errors: SyncErrorDetail[] = [];
      const controller = new ReconnectController({
        connect: connectFn,
        initialDelayMs: 1000,
        backoffFactor: 2,
        jitter: false,
        onError: (detail) => errors.push(detail),
      });

      // Initial manual reconnect triggers attempt 1
      const firstPromise = controller.reconnect();
      await firstPromise;

      expect(controller.status).toBe('connecting');
      expect(controller.reconnectAttempts).toBe(1);
      expect(errors).toHaveLength(1);
      expect(errors[0].reason).toBe('network');

      // Fast forward by 1000ms (first retry delay)
      await vi.advanceTimersByTimeAsync(1000);
      expect(connectFn).toHaveBeenCalledTimes(2);
      expect(controller.reconnectAttempts).toBe(2);
      expect(errors).toHaveLength(2);

      // Fast forward by 2000ms (second retry delay)
      await vi.advanceTimersByTimeAsync(2000);
      expect(connectFn).toHaveBeenCalledTimes(3);
      expect(controller.reconnectAttempts).toBe(0);
      expect(controller.status).toBe('synced');
    });

    it('cancels scheduled retries when cancelReconnect is called', async () => {
      const connectFn = vi.fn().mockRejectedValue(new Error('Network drop'));
      const controller = new ReconnectController({
        connect: connectFn,
        initialDelayMs: 2000,
        jitter: false,
      });

      await controller.reconnect();
      expect(controller.reconnectAttempts).toBe(1);
      expect(controller.isReconnecting).toBe(true);

      controller.cancelReconnect();
      expect(controller.isReconnecting).toBe(false);

      // Advance timers: should not trigger connectFn again
      await vi.advanceTimersByTimeAsync(5000);
      expect(connectFn).toHaveBeenCalledTimes(1);
    });

    it('stops retrying when maxAttempts is reached', async () => {
      const connectFn = vi.fn().mockRejectedValue(new Error('Offline'));
      const controller = new ReconnectController({
        connect: connectFn,
        initialDelayMs: 100,
        backoffFactor: 1,
        maxAttempts: 3,
        jitter: false,
      });

      await controller.reconnect(); // Attempt 1 fails, schedules retry 1
      expect(controller.reconnectAttempts).toBe(1);

      await vi.advanceTimersByTimeAsync(100); // Attempt 2 fails, schedules retry 2
      expect(controller.reconnectAttempts).toBe(2);

      await vi.advanceTimersByTimeAsync(100); // Attempt 3 fails, schedules retry 3
      expect(controller.reconnectAttempts).toBe(3);

      await vi.advanceTimersByTimeAsync(100); // Attempt 4 reaches maxAttempts
      expect(controller.status).toBe('error');
      expect(controller.isReconnecting).toBe(false);
    });

    it('immediately aborts and transitions to error on authentication failure without scheduling retry', async () => {
      const connectFn = vi.fn().mockRejectedValue(new SyncAuthError('Invalid token', 401));
      const errors: SyncErrorDetail[] = [];
      const controller = new ReconnectController({
        connect: connectFn,
        initialDelayMs: 1000,
        onError: (err) => errors.push(err),
      });

      await controller.reconnect();

      expect(controller.status).toBe('error');
      expect(controller.isReconnecting).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0].reason).toBe('auth');

      // Fast forward time: no retry must occur
      await vi.advanceTimersByTimeAsync(10000);
      expect(connectFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Integration with YjsSyncAdapter', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('tracks reconnectAttempts and exposes reconnect() and cancelReconnect() on adapter', async () => {
      const board = createBoard();
      const doc = new Y.Doc();
      let shouldFail = false;

      const adapter = createYjsSyncAdapter({
        doc,
        reconnect: {
          initialDelayMs: 1000,
          backoffFactor: 2,
          jitter: false,
        },
        connect: async () => {
          if (shouldFail) {
            throw new Error('Connection refused');
          }
        },
      });

      expect(adapter.reconnectAttempts).toBe(0);
      expect(adapter.status).toBe('offline');

      // Connect succeeds initially
      await adapter.connect(board);
      expect(adapter.status).toBe('synced');
      expect(adapter.reconnectAttempts).toBe(0);

      // Connection drops (simulated network failure)
      shouldFail = true;
      adapter.handleError?.(new Error('WebSocket closed abnormal (1006)'));

      expect(adapter.status).toBe('connecting');
      expect(adapter.reconnectAttempts).toBe(1);

      // Advance by 1000ms: attempt 1 runs and fails
      await vi.advanceTimersByTimeAsync(1000);
      expect(adapter.reconnectAttempts).toBe(2);
      expect(adapter.status).toBe('connecting');

      // Network recovers
      shouldFail = false;
      // Advance by 2000ms: attempt 2 runs and succeeds
      await vi.advanceTimersByTimeAsync(2000);
      expect(adapter.status).toBe('synced');
      expect(adapter.reconnectAttempts).toBe(0);

      adapter.disconnect();
      expect(adapter.status).toBe('offline');
    });

    it('differentiates auth failure: sets status error, emits auth-error and error events, cancels retry', async () => {
      const board = createBoard();
      const doc = new Y.Doc();

      const adapter = createYjsSyncAdapter({
        doc,
        reconnect: { initialDelayMs: 1000, jitter: false },
      });

      const errorEvents: unknown[] = [];
      const authErrorEvents: unknown[] = [];
      const statusEvents: string[] = [];

      adapter.on('error', (err) => errorEvents.push(err));
      adapter.on('auth-error', (err) => authErrorEvents.push(err));
      adapter.on('status', (status) => statusEvents.push(status));

      await adapter.connect(board);
      expect(adapter.status).toBe('synced');

      // Simulate authentication rejection
      const authErr = { status: 401, message: 'Token expired' };
      adapter.handleError?.(authErr);

      expect(adapter.status).toBe('error');
      expect(errorEvents).toHaveLength(1);
      expect((errorEvents[0] as SyncErrorDetail).reason).toBe('auth');
      expect(authErrorEvents).toHaveLength(1);
      expect((authErrorEvents[0] as SyncErrorDetail).reason).toBe('auth');
      expect(statusEvents).toContain('error');

      // Ensure no automatic backoff is scheduled
      await vi.advanceTimersByTimeAsync(10000);
      expect(adapter.status).toBe('error');
      expect(adapter.reconnectAttempts).toBe(0);

      adapter.disconnect();
    });

    it('emits network error and retries with backoff on normal network failure', async () => {
      const board = createBoard();
      const doc = new Y.Doc();
      let fail = false;

      const adapter = createYjsSyncAdapter({
        doc,
        reconnect: { initialDelayMs: 1000, jitter: false },
        connect: async () => {
          if (fail) throw new Error('ETIMEDOUT');
        },
      });

      const errorEvents: unknown[] = [];
      const authErrorEvents: unknown[] = [];

      adapter.on('error', (err) => errorEvents.push(err));
      adapter.on('auth-error', (err) => authErrorEvents.push(err));

      await adapter.connect(board);
      expect(adapter.status).toBe('synced');

      fail = true;
      adapter.handleError?.(new Error('WebSocket abnormal close (1006)'));

      expect(adapter.status).toBe('connecting');
      expect(errorEvents).toHaveLength(1);
      expect((errorEvents[0] as SyncErrorDetail).reason).toBe('network');
      expect(authErrorEvents).toHaveLength(0); // must not fire auth-error on network issue

      // Fast-forward to retry attempt
      fail = false;
      await vi.advanceTimersByTimeAsync(1000);

      expect(adapter.status).toBe('synced');
      expect(adapter.reconnectAttempts).toBe(0);

      adapter.disconnect();
    });

    it('cancelReconnect() cancels scheduled retry', async () => {
      const board = createBoard();
      const doc = new Y.Doc();
      const connectFn = vi.fn().mockImplementation(async () => {
        throw new Error('Connection drop');
      });

      const adapter = createYjsSyncAdapter({
        doc,
        reconnect: { initialDelayMs: 2000, jitter: false },
        connect: connectFn,
      });

      // Initial connect triggers connection failure and schedules retry in 2000ms
      await adapter.connect(board);
      expect(adapter.reconnectAttempts).toBe(1);

      // Cancel the scheduled reconnection
      adapter.cancelReconnect();

      // Advancing time should not fire connectFn again
      await vi.advanceTimersByTimeAsync(5000);
      expect(connectFn).toHaveBeenCalledTimes(1);

      adapter.disconnect();
    });

    it('manual adapter.reconnect() resets pending timer and executes immediately', async () => {
      const board = createBoard();
      const doc = new Y.Doc();
      let callCount = 0;

      const adapter = createYjsSyncAdapter({
        doc,
        reconnect: { initialDelayMs: 5000, jitter: false },
        connect: async () => {
          callCount++;
        },
      });

      await adapter.connect(board);
      expect(callCount).toBe(1);

      // Trigger a network drop
      adapter.handleError?.(new Error('Dropped'));
      expect(adapter.status).toBe('connecting');

      // Calling reconnect immediately without waiting for the 5000ms timer
      await adapter.reconnect();
      expect(callCount).toBe(2);
      expect(adapter.status).toBe('synced');

      // Advancing timer does not trigger another run
      await vi.advanceTimersByTimeAsync(5000);
      expect(callCount).toBe(2);

      adapter.disconnect();
    });

    it('disconnecting cancels active reconnect timers and resets attempt counts', async () => {
      const board = createBoard();
      const doc = new Y.Doc();
      const connectFn = vi.fn().mockRejectedValue(new Error('Unreachable'));

      const adapter = createYjsSyncAdapter({
        doc,
        reconnect: { initialDelayMs: 1000, jitter: false },
        connect: connectFn,
      });

      await adapter.connect(board);
      expect(adapter.reconnectAttempts).toBe(1);

      adapter.disconnect();
      expect(adapter.status).toBe('offline');
      expect(adapter.reconnectAttempts).toBe(0);

      await vi.advanceTimersByTimeAsync(5000);
      expect(connectFn).toHaveBeenCalledTimes(1);
    });
  });
});
