import { z } from "zod";

/**
 * Typed environment validation (spec FND-004). Parsing happens once at startup so a
 * misconfigured deployment fails immediately rather than at the first request.
 *
 * No secret has a production-usable default. `AUTH_SECRET` is required outside tests.
 */

const postgresUrl = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
    { message: "must be a postgres:// or postgresql:// connection string" },
  );

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    DATABASE_URL: postgresUrl,
    TEST_DATABASE_URL: postgresUrl.optional(),
    /** Database the Playwright suite drives. It is truncated, so it is never DATABASE_URL. */
    E2E_DATABASE_URL: postgresUrl.optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

    AUTH_SECRET: optionalString,
    AUTH_TRUSTED_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    GITHUB_CLIENT_ID: optionalString,
    GITHUB_CLIENT_SECRET: optionalString,

    EMAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
    EMAIL_FROM: z.string().default("morrowlist@localhost"),

    TRASH_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    IDEMPOTENCY_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
    OUTBOX_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message:
          "AUTH_SECRET is required in production; generate with `openssl rand -base64 32`",
      });
    }
    if (env.AUTH_SECRET && env.AUTH_SECRET.length < 32) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message: "AUTH_SECRET must be at least 32 characters",
      });
    }
    // A partially configured OAuth provider is a misconfiguration, but omitting both
    // values is supported: the app must start normally without GitHub sign-in (AUTH-002).
    const hasId = Boolean(env.GITHUB_CLIENT_ID);
    const hasSecret = Boolean(env.GITHUB_CLIENT_SECRET);
    if (hasId !== hasSecret) {
      ctx.addIssue({
        code: "custom",
        path: ["GITHUB_CLIENT_ID"],
        message:
          "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together or both omitted",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class EnvironmentValidationError extends Error {
  constructor(readonly issues: readonly z.core.$ZodIssue[]) {
    const summary = issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    super(`Invalid environment configuration:\n${summary}`);
    this.name = "EnvironmentValidationError";
  }
}

/** Parse and validate the environment. Throws with every issue listed, never a partial value. */
export function parseServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvironmentValidationError(result.error.issues);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Memoised accessor so validation runs once per process. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv();
  return cached;
}

/** Test-only reset so suites can exercise different configurations. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
