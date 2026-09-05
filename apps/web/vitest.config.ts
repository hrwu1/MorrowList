import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Component and hook tests only. The Playwright suite under `e2e/` drives a real browser
 * and is run by `pnpm test:e2e`; collecting it here would start a browser during unit tests.
 */
export default defineConfig({
  // The same `@/` alias `tsconfig.json` and Next resolve, so a module under test can
  // import across features the way the app does.
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["{app,components,features,lib}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**"],
  },
});
