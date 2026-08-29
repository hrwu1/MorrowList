import { defineConfig } from "vitest/config";

/**
 * Component and hook tests only. The Playwright suite under `e2e/` drives a real browser
 * and is run by `pnpm test:e2e`; collecting it here would start a browser during unit tests.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["{app,components,features,lib}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**"],
  },
});
