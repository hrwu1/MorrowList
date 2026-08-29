import { defineConfig } from "vitest/config";

/** Unit-test defaults: fast, no database, no globals. */
export function unitConfig(overrides = {}) {
  return defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.integration.test.ts"],
      ...overrides,
    },
  });
}

/**
 * Integration-test defaults: sequential against a real PostgreSQL database so
 * migrations and transactional behaviour are exercised for real (spec 28.1).
 */
export function integrationConfig(overrides = {}) {
  return defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.integration.test.ts"],
      testTimeout: 30_000,
      hookTimeout: 60_000,
      fileParallelism: false,
      ...overrides,
    },
  });
}
