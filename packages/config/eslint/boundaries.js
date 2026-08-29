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

/** @type {{ area: string, files: string[], forbid: { group: string[], message: string }[] }[]} */
export const boundaries = [
  {
    area: "domain",
    files: ["packages/domain/**/*.ts"],
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
    files: ["packages/application/**/*.ts"],
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
    files: ["packages/contracts/**/*.ts"],
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
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
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
    files: ["apps/cli/**/*.ts"],
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
    area: "ui",
    files: ["packages/ui/**/*.ts", "packages/ui/**/*.tsx"],
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
