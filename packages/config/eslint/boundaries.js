/**
 * Dependency-boundary rules from spec section 16.2.
 *
 * Each entry lists the workspace packages a given source area is forbidden to import.
 * The rules are deliberately expressed as a deny-list of concrete package names and
 * framework modules so a violation fails lint with an explanatory message rather than
 * relying on reviewer memory.
 */

const FRAMEWORK_MODULES = [
  "next",
  "next/*",
  "react",
  "react-dom",
  "hono",
  "hono/*",
  "drizzle-orm",
  "drizzle-orm/*",
  "better-auth",
  "better-auth/*",
  "pg",
];

/**
 * @type {{
 *   area: string,
 *   files: string[],
 *   exclude?: string[],
 *   forbid: { group: string[], message: string }[],
 * }[]}
 */
export const boundaries = [
  {
    area: "domain",
    files: ["packages/domain/src/**/*.ts"],
    forbid: [
      {
        group: FRAMEWORK_MODULES,
        message:
          "packages/domain must stay framework-free: no HTTP, database, auth-provider, or UI imports (spec 16.2).",
      },
      {
        group: ["@morrowlist/*"],
        message:
          "packages/domain is the innermost layer and must not import other workspace packages (spec 16.2).",
      },
    ],
  },
  {
    area: "application",
    files: ["packages/application/src/**/*.ts"],
    forbid: [
      {
        group: FRAMEWORK_MODULES,
        message:
          "packages/application defines ports only: it must not import Next.js, Hono, Drizzle, or Better Auth (spec 16.2).",
      },
      {
        group: [
          "@morrowlist/database",
          "@morrowlist/database/*",
          "@morrowlist/api",
          "@morrowlist/api/*",
          "@morrowlist/auth",
          "@morrowlist/auth/*",
          "@morrowlist/ui",
          "@morrowlist/ui/*",
          "@morrowlist/api-client",
        ],
        message:
          "packages/application may import @morrowlist/domain, @morrowlist/contracts and @morrowlist/observability only; adapters implement its ports (spec 16.2).",
      },
    ],
  },
  {
    area: "contracts",
    files: ["packages/contracts/src/**/*.ts"],
    forbid: [
      {
        group: FRAMEWORK_MODULES,
        message:
          "packages/contracts holds transport schemas only and must not depend on a framework (spec 16.2).",
      },
      {
        group: ["@morrowlist/*"],
        message:
          "packages/contracts must not import other workspace packages; it is a leaf schema package (spec 16.2).",
      },
    ],
  },
  {
    area: "web",
    // `lib/server.ts` is the composition root (spec 16.1): it is the single file allowed
    // to construct the database adapter and wire it into the application layer. Every
    // other file in the app reaches data through the API.
    //
    // `e2e/global-setup.ts` is harness code, not application code: it migrates and
    // truncates the database the browser suite drives, before Next.js starts.
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    exclude: ["apps/web/lib/server.ts", "apps/web/e2e/global-setup.ts"],
    forbid: [
      {
        group: [
          "@morrowlist/database",
          "@morrowlist/database/*",
          "drizzle-orm",
          "drizzle-orm/*",
          "pg",
        ],
        message:
          "apps/web must never import Drizzle schema or repositories; go through the API (spec 16.2).",
      },
    ],
  },
  {
    area: "cli",
    files: ["apps/cli/src/**/*.ts"],
    forbid: [
      {
        group: [
          "@morrowlist/database",
          "@morrowlist/database/*",
          "@morrowlist/application",
          "@morrowlist/application/*",
          "drizzle-orm",
          "drizzle-orm/*",
          "pg",
        ],
        message:
          "apps/cli communicates through @morrowlist/api-client only; it must not reach PostgreSQL or the application layer directly (spec 16.2).",
      },
    ],
  },
  {
    // apps/mcp is a transport adapter like the CLI (ADR-005, docs/adr/pending-mcp-server.md):
    // it speaks the public REST API and nothing else, so an agent is subject to the same
    // rules as a person.
    area: "mcp",
    files: ["apps/mcp/src/**/*.ts"],
    forbid: [
      {
        group: [
          "@morrowlist/database",
          "@morrowlist/database/*",
          "@morrowlist/application",
          "@morrowlist/application/*",
          "@morrowlist/api",
          "@morrowlist/api/*",
          "drizzle-orm",
          "drizzle-orm/*",
          "pg",
        ],
        message:
          "apps/mcp communicates through @morrowlist/api-client only; it must not reach PostgreSQL, the application layer, or the API package directly (spec 16.2).",
      },
    ],
  },
  {
    area: "ui",
    files: ["packages/ui/src/**/*.ts", "packages/ui/src/**/*.tsx"],
    forbid: [
      {
        group: [
          "@morrowlist/database",
          "@morrowlist/database/*",
          "@morrowlist/application",
          "@morrowlist/application/*",
          "@morrowlist/api",
          "@morrowlist/api/*",
        ],
        message:
          "packages/ui is presentation only and must not import server-side layers (spec 16.2).",
      },
    ],
  },
];

/** Deep imports into another package's internals are forbidden everywhere (spec 16.2). */
export const noDeepImports = {
  group: ["@morrowlist/*/src/**", "@morrowlist/*/dist/**"],
  message:
    "Import a package's public entry point; deep imports into another package's internals are forbidden (spec 16.2).",
};
