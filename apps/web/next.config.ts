import { loadRootEnv } from "@morrowlist/config/load-env";
import type { NextConfig } from "next";

// The single `.env` lives at the workspace root; Next only looks beside this app. Load it
// here, before the config is evaluated, so the server starts configured.
loadRootEnv();

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources compiled to ESM; Next must transpile them
  // rather than treat them as pre-built CommonJS dependencies.
  transpilePackages: [
    "@morrowlist/api",
    "@morrowlist/api-client",
    "@morrowlist/application",
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
