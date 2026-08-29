#!/usr/bin/env node
/**
 * Negative test for the dependency-boundary rules (FND-003).
 *
 * Each fixture is a deliberate violation. It is copied to the repository path the rule
 * targets, linted there, and removed again. The check fails if a fixture lints clean,
 * because a boundary rule that has silently stopped matching looks like enforcement while
 * enforcing nothing.
 */
import { execFile } from "node:child_process";
import { mkdir, copyFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(root, "packages", "config", "boundary-fixtures");

/** Each fixture, the path it must be linted at, and the rule text expected to fire. */
const CASES = [
  {
    fixture: "domain/framework-import.ts.fixture",
    target: "packages/domain/src/__boundary_fixture__.ts",
    expect: "framework-free",
  },
  {
    fixture: "domain/database-import.ts.fixture",
    target: "packages/domain/src/__boundary_fixture__.ts",
    expect: "innermost layer",
  },
  {
    fixture: "web/database-import.ts.fixture",
    target: "apps/web/__boundary_fixture__.ts",
    expect: "never import Drizzle",
  },
  {
    fixture: "web/deep-import.ts.fixture",
    target: "apps/web/__boundary_fixture__.ts",
    expect: "public entry point",
  },
];

async function lint(path) {
  try {
    const { stdout } = await run(
      "node",
      ["node_modules/eslint/bin/eslint.js", "--format", "json", "--no-ignore", path],
      { cwd: root, maxBuffer: 10 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } catch (error) {
    // ESLint exits non-zero when it reports errors, which is the expected path here.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

let failures = 0;

for (const testCase of CASES) {
  const target = join(root, testCase.target);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(fixtureRoot, testCase.fixture), target);

  try {
    const results = await lint(target);
    const messages = results.flatMap((result) => result.messages);
    const matched = messages.some((message) =>
      (message.message ?? "").includes(testCase.expect),
    );

    if (matched) {
      console.log(`  ok   ${testCase.fixture}`);
    } else {
      failures += 1;
      console.error(
        `  FAIL ${testCase.fixture}\n` +
          `       expected a message containing ${JSON.stringify(testCase.expect)}\n` +
          `       got: ${messages.map((m) => m.message).join(" | ") || "(no messages)"}`,
      );
    }
  } finally {
    await rm(target, { force: true });
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} boundary rule(s) did not fire. The architecture is not being enforced.`,
  );
  process.exit(1);
}

console.log(`\nAll ${CASES.length} boundary rules fired as expected.`);
