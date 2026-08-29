import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOpenApiDocument } from "./openapi.js";

/**
 * `openapi:generate` writes the document; `openapi:check` fails when the committed copy
 * differs from what the schemas produce (spec 20.7). CI runs the check.
 */

const target = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs",
  "api",
  "openapi.json",
);

const generated = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  let committed: string;
  try {
    committed = await readFile(target, "utf8");
  } catch {
    console.error(
      `docs/api/openapi.json is missing. Run \`pnpm openapi:generate\` and commit the result.`,
    );
    process.exit(1);
  }
  if (committed !== generated) {
    console.error(
      "docs/api/openapi.json is out of date with the Zod schemas.\n" +
        "Run `pnpm openapi:generate` and commit the result.",
    );
    process.exit(1);
  }
  console.log("OpenAPI document is up to date.");
} else {
  await writeFile(target, generated);
  console.log(`wrote ${target}`);
}
