import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";
import { boundaries, noDeepImports } from "./boundaries.js";

/**
 * Shared flat ESLint config. Run from the repository root so the boundary globs,
 * which are repository-relative, resolve correctly.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/drizzle/**",
      "**/*.fixture.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "import-x": importX },
    rules: {
      "import-x/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          pathGroups: [
            { pattern: "@morrowlist/**", group: "internal", position: "before" },
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import-x/no-duplicates": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-restricted-imports": ["error", { patterns: [noDeepImports] }],
    },
  },
  // Dependency-boundary enforcement (spec 16.2). One config block per architectural area.
  ...boundaries.map((boundary) => ({
    files: boundary.files,
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...boundary.forbid, noDeepImports] },
      ],
    },
  })),
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "packages/testkit/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
