/**
 * Unit tests for authentication and authorization logic (BOARD-1510).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAuthVerifier, UnauthorizedError } from './auth.js';

describe('Auth Module', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('createAuthVerifier (Mock mode)', () => {
    const verifier = createAuthVerifier();

    it('parses "editor" token correctly', async () => {
      const result = await verifier('editor', 'board-1');
      expect(result.readOnly).toBe(false);
      expect(result.user.id).toBe('user-editor');
      expect(result.user.name).toBe('Editor');
    });

    it('parses "viewer" and "readonly" tokens correctly', async () => {
      const v1 = await verifier('viewer', 'board-1');
      expect(v1.readOnly).toBe(true);
      expect(v1.user.name).toBe('Viewer');

      const v2 = await verifier('readonly', 'board-1');
      expect(v2.readOnly).toBe(true);
    });

    it('parses structured mock tokens (mock:<id>:<role>:<name>)', async () => {
      const result = await verifier('mock:usr-99:editor:Siti', 'board-1');
      expect(result.readOnly).toBe(false);
      expect(result.user.id).toBe('usr-99');
      expect(result.user.name).toBe('Siti');

      const viewerResult = await verifier('mock:usr-100:viewer:Bambang', 'board-1');
      expect(viewerResult.readOnly).toBe(true);
      expect(viewerResult.user.id).toBe('usr-100');
      expect(viewerResult.user.name).toBe('Bambang');
    });

    it('throws UnauthorizedError on empty token when anonymous is false', async () => {
      await expect(verifier('', 'board-1')).rejects.toThrow(UnauthorizedError);
      await expect(verifier('   ', 'board-1')).rejects.toThrow(UnauthorizedError);
    });

    it('allows anonymous viewer if allowAnonymous is set to true', async () => {
      const anonVerifier = createAuthVerifier({ allowAnonymous: true });
      const result = await anonVerifier('', 'board-1');
      expect(result.readOnly).toBe(true);
      expect(result.user.id).toBe('anonymous');
    });

    it('throws UnauthorizedError on unknown token string', async () => {
      await expect(verifier('random-junk', 'board-1')).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('createAuthVerifier (HTTP endpoint delegation)', () => {
    it('sends POST request to external auth endpoint and parses result', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          user: { id: 'ext-42', name: 'External User' },
          readOnly: false,
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      const verifier = createAuthVerifier({ authEndpointUrl: 'https://auth.example.com/verify' });
      const result = await verifier('bearer-token-xyz', 'board-abc');

      expect(mockFetch).toHaveBeenCalledWith('https://auth.example.com/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'bearer-token-xyz', documentName: 'board-abc' }),
      });

      expect(result.readOnly).toBe(false);
      expect(result.user.id).toBe('ext-42');
      expect(result.user.name).toBe('External User');
    });

    it('throws UnauthorizedError if external endpoint returns non-200', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      }) as unknown as typeof fetch;

      const verifier = createAuthVerifier({ authEndpointUrl: 'https://auth.example.com/verify' });
      await expect(verifier('bad-token', 'board-1')).rejects.toThrow(UnauthorizedError);
    });
  });
});
