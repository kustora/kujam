/**
 * Authentication and authorization handlers for the collaboration server (BOARD-1510).
 *
 * Verifies client tokens, resolves user identities, and determines per-connection permissions (read-only vs edit).
 *
 * @packageDocumentation
 */

/**
 * Collaborator user identity resolved from authentication.
 */
export interface AuthUser {
  id: string;
  name: string;
  avatar?: string;
  color?: string;
}

/**
 * Result returned by an authentication verifier.
 */
export interface AuthResult {
  /**
   * The authenticated user profile.
   */
  user: AuthUser;

  /**
   * Whether the connection is restricted to read-only mode.
   * When true, server rejects document updates from this client.
   */
  readOnly: boolean;
}

/**
 * Custom function signature for verifying authentication tokens.
 */
export type AuthVerifier = (
  token: string,
  documentName: string,
) => Promise<AuthResult> | AuthResult;

/**
 * Options for configuring the authentication system.
 */
export interface AuthOptions {
  /**
   * Custom token verifier function.
   */
  verifyToken?: AuthVerifier;

  /**
   * Optional HTTP endpoint URL for delegating token verification.
   * Sends a POST request with `{ token, documentName }`.
   */
  authEndpointUrl?: string;

  /**
   * Whether to allow anonymous connections when no token is provided.
   * If true, anonymous connections receive read-only permissions by default.
   * Defaults to false (authentication required).
   */
  allowAnonymous?: boolean;
}

/**
 * Error thrown when authentication fails.
 */
export class UnauthorizedError extends Error {
  constructor(message: string = 'Unauthorized: invalid or missing authentication token') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Creates an authentication verifier based on configuration options.
 *
 * Supports mock tokens (e.g. "editor", "viewer", or "mock:user1:viewer:Alice"),
 * external HTTP auth endpoints, or custom token verification callbacks.
 *
 * @param options - Configuration options for authentication.
 * @returns An async function that verifies a token and returns an AuthResult.
 */
export function createAuthVerifier(options: AuthOptions = {}): AuthVerifier {
  return async (token: string, documentName: string): Promise<AuthResult> => {
    // 1. Check for missing token
    if (!token || token.trim() === '') {
      if (options.allowAnonymous) {
        return {
          user: { id: 'anonymous', name: 'Anonymous Viewer' },
          readOnly: true,
        };
      }
      throw new UnauthorizedError('Missing authentication token');
    }

    // 2. Delegate to custom verifier if provided
    if (options.verifyToken) {
      return await options.verifyToken(token, documentName);
    }

    // 3. Delegate to HTTP endpoint if configured
    if (options.authEndpointUrl) {
      try {
        const response = await fetch(options.authEndpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, documentName }),
        });

        if (!response.ok) {
          throw new UnauthorizedError(`Authentication endpoint returned HTTP ${response.status}`);
        }

        const data = (await response.json()) as Partial<AuthResult>;
        if (!data || !data.user || typeof data.user.id !== 'string') {
          throw new UnauthorizedError('Malformed response from authentication endpoint');
        }

        return {
          user: data.user,
          readOnly: Boolean(data.readOnly),
        };
      } catch (err) {
        if (err instanceof UnauthorizedError) throw err;
        throw new UnauthorizedError(
          `Authentication request failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 4. Default built-in token parser (supports mock tokens)
    return parseMockToken(token);
  };
}

/**
 * Parses built-in mock token formats for local development and testing.
 *
 * Formats:
 * - "editor" -> user "user-editor", readOnly: false
 * - "viewer" | "readonly" -> user "user-viewer", readOnly: true
 * - "mock:<id>:<role>:<name>" -> e.g. "mock:usr1:editor:Alice" or "mock:usr2:viewer:Bob"
 *
 * @param token - Token string to parse.
 * @returns AuthResult if valid, or throws UnauthorizedError.
 */
function parseMockToken(token: string): AuthResult {
  const trimmed = token.trim();

  if (trimmed === 'editor') {
    return {
      user: { id: 'user-editor', name: 'Editor' },
      readOnly: false,
    };
  }

  if (trimmed === 'viewer' || trimmed === 'readonly') {
    return {
      user: { id: 'user-viewer', name: 'Viewer' },
      readOnly: true,
    };
  }

  if (trimmed.startsWith('mock:')) {
    const parts = trimmed.split(':');
    const id = parts[1] || 'user-mock';
    const role = (parts[2] || 'viewer').toLowerCase();
    const name = parts[3] || id;

    const isReadOnly = role === 'viewer' || role === 'readonly' || role === 'read';
    return {
      user: { id, name },
      readOnly: isReadOnly,
    };
  }

  throw new UnauthorizedError(`Invalid authentication token: "${token}"`);
}
