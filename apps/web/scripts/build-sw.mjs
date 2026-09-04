import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

/**
 * Bundles the service worker (spec 25) into one classic worker script under `public/`.
 *
 * The worker's version is a hash of its own bundle, so a rebuild of unchanged sources
 * produces the same file — and the browser only installs a new worker when the bytes
 * differ. The version names every cache the worker owns, which is what lets a new worker
 * drop the previous version's caches on activation.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLACEHOLDER = "__SW_VERSION__";

const result = await build({
  absWorkingDir: root,
  entryPoints: ["sw/sw.ts"],
  bundle: true,
  write: false,
  format: "iife",
  target: "es2022",
  define: { __SW_VERSION__: JSON.stringify(PLACEHOLDER) },
});

const bundle = result.outputFiles[0].text;
const version = createHash("sha256").update(bundle).digest("hex").slice(0, 12);
await writeFile(
  join(root, "public", "sw.js"),
  bundle.replaceAll(JSON.stringify(PLACEHOLDER), JSON.stringify(version)),
);
