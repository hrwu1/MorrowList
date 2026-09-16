import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadRootEnv } from "@morrowlist/config/load-env";
import type { NextConfig } from "next";

// The single `.env` lives at the workspace root; Next only looks beside this app. Load it
// here, before the config is evaluated, so the server starts configured.
loadRootEnv();

// Standalone output is what the production image runs (spec 31.2, GAP-23), and it is
// opt-in: development, `next start`, and the Playwright suite keep the ordinary build, so
// how the image is packaged cannot change what the suites exercise. File tracing has to
// start at the workspace root or it misses the `@morrowlist/*` packages, which pnpm links
// from outside this app's directory.
const standalone = process.env.NEXT_OUTPUT === "standalone";
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const config: NextConfig = {
  ...(standalone
    ? { output: "standalone" as const, outputFileTracingRoot: workspaceRoot }
    : {}),
  reactStrictMode: true,
  // CalDAV collections end in a slash; Next must not redirect them away (GAP-25).
  skipTrailingSlashRedirect: true,
  // Feed paths contain bearer credentials; Hono logs a redacted path instead.
  logging: { incomingRequests: { ignore: [/\/api\/v1\/feeds\//] } },
  // Workspace packages ship TypeScript sources compiled to ESM; Next must transpile them
  // rather than treat them as pre-built CommonJS dependencies.
  transpilePackages: [
    "@morrowlist/api",
    "@morrowlist/api-client",
    "@morrowlist/application",
    "@morrowlist/transports",
    "@morrowlist/auth",
    "@morrowlist/config",
    "@morrowlist/contracts",
    "@morrowlist/database",
    "@morrowlist/domain",
    "@morrowlist/observability",
    "@morrowlist/ui",
  ],
  serverExternalPackages: ["pg"],
  // Linting runs from the repository root as its own CI step, where the shared flat
  // config resolves. Running it again here would resolve from apps/web and fail.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  // The e2e suite drives the dev server over 127.0.0.1 rather than localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default config;
