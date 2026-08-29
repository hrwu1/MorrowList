import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated from the schema and then reviewed and committed as SQL
 * (spec 15.2, 32). Nothing is applied to a database directly from the schema file.
 */
export default defineConfig({
  // Generation reads the compiled schema: drizzle-kit bundles as CommonJS and cannot
  // resolve the explicit .js specifiers that Node ESM requires in the TypeScript source.
  // `pnpm db:generate` builds first.
  schema: "./dist/schema/index.js",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/morrowlist",
  },
  strict: true,
  verbose: true,
});
