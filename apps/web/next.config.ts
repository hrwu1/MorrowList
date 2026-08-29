import type { NextConfig } from "next";

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
};

export default config;
