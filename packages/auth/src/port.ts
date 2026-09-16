import type { ActorContext } from "@morrowlist/application";
import { newRequestId } from "@morrowlist/observability";

import type { AuthInstance } from "./auth.js";

/**
 * Auth adapter boundary (spec 22.2).
 *
 * The API depends on this port, not on Better Auth. It answers one question: given the
 * inbound request headers, who is calling and what may they reach?
 */

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
}

export interface AuthPort {
  /** Resolve the caller from request headers, or null when unauthenticated. */
  resolveUser(headers: Headers): Promise<AuthenticatedUser | null>;
  /**
   * Mint a bearer token for `email` after re-checking `password`; null when they do not
   * match. The token is an independent session: signing the browser out leaves it alone,
   * and it expires after 30 days without use (GAP-25).
   */
  issueToken(email: string, password: string): Promise<{ token: string } | null>;
  /** Handle a Better Auth endpoint request under `/api/auth/*`. */
  handleRequest(request: Request): Promise<Response>;
}

export function createAuthPort(auth: AuthInstance): AuthPort {
  return {
    async resolveUser(headers) {
      const session = await auth.api.getSession({ headers });
      if (!session?.user) return null;
      return {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name || null,
      };
    },
    async issueToken(email, password) {
      try {
        const result = await auth.api.signInEmail({ body: { email, password } });
        return result.token ? { token: result.token } : null;
      } catch {
        return null;
      }
    },
    handleRequest: (request) => auth.handler(request),
  };
}

/**
 * Build the `ActorContext` for a signed-in user (AUTH-004). A session-authenticated user
 * holds every scope their membership allows, so the scope set is left empty and
 * `assertScope` short-circuits for the `user` actor kind.
 */
export function userActorContext(
  user: AuthenticatedUser,
  workspaceIds: readonly string[],
  requestId: string = newRequestId(),
): ActorContext {
  return {
    actorKind: "user",
    actorId: user.id,
    userId: user.id,
    actorDisplayName: user.name ?? user.email,
    workspaceIds,
    scopes: new Set(),
    requestId,
  };
}
