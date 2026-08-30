import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Loads the repository-root `.env` into `process.env` for tools that do not read one
 * themselves.
 *
 * `next dev` only looks for `.env` beside the app it is serving, and bare `vitest` and
 * `playwright` look for none at all — so in this workspace, where the single `.env` sits
 * at the root, every one of them starts with an unconfigured environment and
 * `parseServerEnv` throws on `DATABASE_URL`.
 *
 * `process.loadEnvFile` leaves variables that are already set alone, so this never
 * overrides a real deployment or CI's `env:` block. When there is no `.env` on disk — CI,
 * production — it does nothing at all.
 */

const WORKSPACE_MARKER = "pnpm-workspace.yaml";

let loaded = false;

/** Walks up from `start` to the directory holding the workspace marker. */
function findWorkspaceRoot(start: string): string | undefined {
  let directory = start;
  for (;;) {
    if (existsSync(join(directory, WORKSPACE_MARKER))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/**
 * Populate `process.env` from the workspace-root `.env`, once per process.
 *
 * Returns the path that was loaded, or `undefined` when there was nothing to load.
 */
export function loadRootEnv(start: string = process.cwd()): string | undefined {
  if (loaded) return undefined;
  loaded = true;

  const root = findWorkspaceRoot(start);
  if (!root) return undefined;

  const envFile = join(root, ".env");
  if (!existsSync(envFile)) return undefined;

  process.loadEnvFile(envFile);
  return envFile;
}

/** Test-only reset so suites can exercise the loader more than once. */
export function resetRootEnvLoaded(): void {
  loaded = false;
}
