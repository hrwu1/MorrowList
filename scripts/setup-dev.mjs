#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");
const envExamplePath = resolve(root, ".env.example");

function fail(message) {
  console.error(`\nSetup failed: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
  });
  if (result.error?.code === "ENOENT") {
    fail(`required command \`${command}\` was not found`);
  }
  if (result.status !== 0) {
    fail(`\`${command} ${args.join(" ")}\` exited with status ${result.status}`);
  }
}

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < 24) {
  fail(`Node.js 24 or newer is required (found ${process.versions.node})`);
}

console.log("Installing workspace dependencies...");
run("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], {
  env: { CI: "1" },
});

try {
  readFileSync(envPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  copyFileSync(envExamplePath, envPath);
  const template = readFileSync(envPath, "utf8");
  const secret = randomBytes(32).toString("base64");
  writeFileSync(envPath, template.replace(/^AUTH_SECRET=$/m, `AUTH_SECRET=${secret}`));
  console.log("Created .env with a generated local AUTH_SECRET.");
}

process.loadEnvFile(envPath);
if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL is missing from .env");
}

let databaseUrl;
try {
  databaseUrl = new URL(process.env.DATABASE_URL);
} catch {
  fail("DATABASE_URL in .env is not a valid URL");
}

const readiness = spawnSync(
  "pg_isready",
  ["-h", databaseUrl.hostname, "-p", databaseUrl.port || "5432"],
  { cwd: root, stdio: "ignore" },
);
if (readiness.error?.code === "ENOENT") {
  fail("pg_isready was not found; install PostgreSQL 18 and start it before setup");
}
if (readiness.status !== 0) {
  fail(
    `PostgreSQL is not reachable at ${databaseUrl.hostname}:${databaseUrl.port || "5432"}. ` +
      "Start it with `brew services start postgresql@18` or the documented Docker Compose command.",
  );
}

console.log("Building workspace packages...");
run("pnpm", ["--filter", "./packages/**", "build"]);

console.log("Applying database migrations...");
run("pnpm", ["db:migrate"]);

console.log("\nDevelopment setup complete. Start MorrowList with: pnpm dev");
