import type { ServerEnv } from "@morrowlist/config/env";
import type { Database } from "@morrowlist/database";
import { uuidv7 } from "@morrowlist/domain";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { authSchema } from "./schema.js";

/**
 * Better Auth configuration (AUTH-001).
 *
 * Everything provider-specific stops here. The rest of the application consumes the
 * `AuthPort` in `port.ts`, so replacing the provider means rewriting this file only.
 */

export type AuthInstance = ReturnType<typeof betterAuth>;

export interface CreateAuthOptions {
  readonly db: Database;
  readonly env: ServerEnv;
  /**
   * Called after a user is created, inside the auth flow. Used to run the transactional
   * workspace bootstrap (AUTH-003). Must be idempotent: the callback can be retried.
   */
  readonly onUserCreated?: (user: {
    id: string;
    email: string;
    name: string | null;
  }) => Promise<void>;
}

export function createAuth(options: CreateAuthOptions): AuthInstance {
  const { env } = options;

  // GitHub sign-in is optional: with no credentials configured the provider is simply
  // absent and the application starts normally (AUTH-002).
  const socialProviders =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        }
      : {};

  return betterAuth({
    appName: "MorrowList",
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET ?? "development-only-secret-change-me-now",
    trustedOrigins: [...env.AUTH_TRUSTED_ORIGINS],
    database: drizzleAdapter(options.db, {
      provider: "pg",
      schema: authSchema,
    }),
    advanced: {
      database: {
        // UUIDv7 so provider identifiers can be stored in MorrowList's uuid columns and
        // stay time-ordered like every other primary key.
        generateId: () => uuidv7(),
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      // Email delivery is an adapter and is not wired up in this slice; requiring
      // verification here would make local sign-up impossible without a mail server.
      requireEmailVerification: false,
    },
    socialProviders,
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await options.onUserCreated?.({
              id: user.id,
              email: user.email,
              name: user.name || null,
            });
          },
        },
      },
    },
  });
}
