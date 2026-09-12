#!/usr/bin/env node
/** Prove the matrix using virtual files: no compiler-visible fixtures or write races. */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import { allowedDependencies } from "../packages/config/eslint/boundaries.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const eslint = new ESLint({ cwd: root });
const packages = Object.keys(allowedDependencies).filter(
  (name) => !["web", "cli", "mcp"].includes(name),
);
const sourcePath = (area) =>
  ["web", "cli", "mcp"].includes(area)
    ? `apps/${area}/src/boundary-check.ts`
    : `packages/${area}/src/boundary-check.ts`;
const cases = [];
for (const [source, allowed] of Object.entries(allowedDependencies)) {
  for (const target of packages) {
    if (target === source) continue;
    // New adapter packages may not exist in older checkouts; only check installed manifests.
    try {
      await readFile(join(root, "packages", target, "package.json"));
    } catch {
      continue;
    }
    cases.push({
      path: sourcePath(source),
      source: `import * as dep from "@morrowlist/${target}";\nexport { dep };`,
      blocked: !allowed.includes(target),
      name: `${source} → ${target}`,
    });
  }
}
const probes = [
  [
    "application",
    "export function transform(fetch: (x: number) => number) { return fetch(1); }",
    false,
    "local function named fetch",
  ],
  [
    "application",
    'export const load = () => globalThis.fetch("https://example.com");',
    true,
    "ambient fetch",
  ],
  [
    "domain",
    'export const load = () => fetch("https://example.com");',
    true,
    "domain fetch",
  ],
  [
    "contracts",
    'export const load = () => globalThis["fetch"]("https://example.com");',
    true,
    "computed fetch",
  ],
  [
    "domain",
    'import { createDatabase } from "../../database/src/index.js";\nexport { createDatabase };',
    true,
    "relative escape",
  ],
  ["web", 'export * from "@morrowlist/application";', true, "re-export escape"],
  [
    "cli",
    'export const load = () => import("@morrowlist/api");',
    true,
    "dynamic import escape",
  ],
  [
    "domain",
    'export const load = () => require("@morrowlist/database");',
    true,
    "require escape",
  ],
  [
    "web",
    'export * from "@/../../packages/database/src/index.js";',
    true,
    "alias escape",
  ],
  [
    "domain",
    'import * as dep from "react/jsx-runtime";\nexport { dep };',
    true,
    "framework subpath",
  ],
  ["domain", 'export * from "node:fs";', true, "domain I/O"],
  [
    "web",
    'export * from "@morrowlist/contracts/src/task.js";',
    true,
    "private subpath",
  ],
  ["web", 'export * from "@morrowlist/config/env";', false, "public subpath"],
];
for (const [area, source, blocked, name] of probes)
  cases.push({ path: sourcePath(area), source, blocked, name });
for (const [path, target, blocked] of [
  ["apps/web/lib/server.ts", "database", false],
  ["packages/application/src/email-config.ts", "config", true],
  ["apps/web/e2e/global-setup.ts", "database", false],
  ["apps/web/e2e/workflow.spec.ts", "database", true],
  ["packages/api/src/app.test.ts", "testkit", false],
  ["packages/api/src/app.test.ts", "database", false],
  ["packages/application/vitest.config.ts", "config", false],
])
  cases.push({
    path,
    source: `export * from "@morrowlist/${target}";`,
    blocked,
    name: path,
  });
let failures = 0;
for (const test of cases) {
  const [result] = await eslint.lintText(test.source, {
    filePath: join(root, test.path),
  });
  const messages = result.messages.filter(
    (message) => message.ruleId === "architecture/dependencies",
  );
  if (
    messages.length > 0 !== test.blocked ||
    result.messages.some((message) => message.fatal)
  ) {
    failures++;
    process.stderr.write(
      `FAIL ${test.name}: ${messages.map((message) => message.message).join(" | ") || "no boundary error"}\n`,
    );
  }
}
if (failures) {
  process.stderr.write(`${failures} architecture checks failed.\n`);
  process.exit(1);
}
process.stdout.write(
  `All ${cases.length} architecture checks passed (allowed and forbidden imports).\n`,
);
