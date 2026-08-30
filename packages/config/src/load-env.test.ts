import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadRootEnv, resetRootEnvLoaded } from "./load-env.js";

/**
 * The loader exists so `next dev`, `vitest`, and `playwright` see the workspace-root
 * `.env`. What matters is that it never overrides an environment that is already
 * configured — CI sets its variables directly, and a deployment has no `.env` at all.
 */

let root: string;
const touched: string[] = [];

function makeWorkspace(envContents?: string): string {
  const directory = mkdtempSync(join(tmpdir(), "morrowlist-load-env-"));
  writeFileSync(
    join(directory, "pnpm-workspace.yaml"),
    'packages:\n  - "packages/*"\n',
  );
  if (envContents !== undefined) writeFileSync(join(directory, ".env"), envContents);
  return directory;
}

function setEnv(name: string, value: string | undefined): void {
  touched.push(name);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  resetRootEnvLoaded();
});

afterEach(() => {
  for (const name of touched) delete process.env[name];
  touched.length = 0;
  rmSync(root, { recursive: true, force: true });
  resetRootEnvLoaded();
});

describe("loadRootEnv", () => {
  it("fills in a variable that is not already set", () => {
    root = makeWorkspace("MORROWLIST_TEST_FILLED=from-file\n");
    setEnv("MORROWLIST_TEST_FILLED", undefined);

    expect(loadRootEnv(root)).toBe(join(root, ".env"));
    expect(process.env.MORROWLIST_TEST_FILLED).toBe("from-file");
  });

  it("leaves an already-set variable alone", () => {
    root = makeWorkspace("MORROWLIST_TEST_KEPT=from-file\n");
    setEnv("MORROWLIST_TEST_KEPT", "from-environment");

    loadRootEnv(root);

    // CI sets its variables in the workflow and a deployment sets real ones; a stray
    // `.env` must never win over them.
    expect(process.env.MORROWLIST_TEST_KEPT).toBe("from-environment");
  });

  it("finds the root from a nested working directory", () => {
    root = makeWorkspace("MORROWLIST_TEST_NESTED=from-file\n");
    setEnv("MORROWLIST_TEST_NESTED", undefined);

    expect(loadRootEnv(join(root, "packages", "database"))).toBe(join(root, ".env"));
    expect(process.env.MORROWLIST_TEST_NESTED).toBe("from-file");
  });

  it("does nothing when the workspace has no .env", () => {
    root = makeWorkspace();

    expect(loadRootEnv(root)).toBeUndefined();
  });

  it("loads at most once per process", () => {
    root = makeWorkspace("MORROWLIST_TEST_ONCE=from-file\n");
    setEnv("MORROWLIST_TEST_ONCE", undefined);

    expect(loadRootEnv(root)).toBe(join(root, ".env"));
    expect(loadRootEnv(root)).toBeUndefined();
  });
});
