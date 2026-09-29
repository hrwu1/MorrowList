#!/usr/bin/env node
/**
 * Measure the spec 29.2 budgets at the spec 29.1 reference scale (GAP-23).
 *
 * The whole run is self-contained: it migrates and truncates a throwaway database, starts
 * the production server against it, signs up over the API, fills that account's workspace
 * with `scripts/seed-scale.mjs`, then drives the real HTTP endpoints and reports p50, p95
 * and p99 per scenario.
 *
 * Load is generated here rather than by autocannon: the scenarios need a session cookie,
 * a different URL per iteration, and mutations that must not touch the same task twice,
 * none of which a static load tool expresses. The driver is a fixed number of concurrent
 * workers pulling from one queue of iterations, which is what autocannon does too.
 *
 *   BENCH_DATABASE_URL=postgresql://... node scripts/bench.mjs
 *   node scripts/bench.mjs --base-url http://127.0.0.1:3200 --skip-seed   # existing server
 *   node scripts/bench.mjs --check previous-run.json                      # nightly CI
 *
 * Options:
 *   --database-url URL   throwaway database (default BENCH_DATABASE_URL); never DATABASE_URL
 *   --base-url URL       drive a server that is already running instead of starting one
 *   --port N             port to start the server on (default BENCH_PORT, then 3299)
 *   --scale NAME         seed scale, `reference` (default) or `small`
 *   --concurrency N      concurrent requests per scenario (default 4)
 *   --iterations N       measured iterations per read scenario (default 200)
 *   --skip-seed          the target database is already seeded
 *   --out FILE           write the results as JSON
 *   --check FILE         compare against a baseline and exit non-zero on a regression
 *   --regression PCT     how much slower than the baseline p95 may be (default 20)
 */
import { spawn } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, loadavg, release, totalmem, type } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const load = (name) => import(pathToFileURL(require.resolve(name)).href);

const [{ loadRootEnv }, database] = await Promise.all([
  load("@morrowlist/config/load-env"),
  load("@morrowlist/database"),
]);
loadRootEnv();

const { values } = parseArgs({
  options: {
    "database-url": { type: "string" },
    "base-url": { type: "string" },
    port: { type: "string" },
    scale: { type: "string", default: "reference" },
    concurrency: { type: "string", default: "4" },
    iterations: { type: "string", default: "200" },
    "skip-seed": { type: "boolean", default: false },
    out: { type: "string" },
    check: { type: "string" },
    regression: { type: "string", default: "20" },
  },
});

const CONCURRENCY = Number(values.concurrency);
const ITERATIONS = Number(values.iterations);
/** Mutations consume a task each, so they run fewer iterations than the reads. */
const MUTATION_ITERATIONS = Math.max(50, Math.round(ITERATIONS / 2));
const WARMUP = 10;

const databaseUrl =
  values["database-url"] ?? process.env.BENCH_DATABASE_URL ?? undefined;
const externalServer = values["base-url"];

if (!externalServer && !databaseUrl) {
  console.error(
    "bench: set BENCH_DATABASE_URL (a throwaway database) or pass --base-url for a running server.",
  );
  process.exit(1);
}
if (databaseUrl && databaseUrl === process.env.DATABASE_URL) {
  console.error("bench: refusing to truncate DATABASE_URL. Use a throwaway database.");
  process.exit(1);
}

const PORT = Number(values.port ?? process.env.BENCH_PORT ?? 3299);
const baseUrl = externalServer ?? `http://127.0.0.1:${PORT}`;
const PASSWORD = "correct-horse-battery-staple";
const email = `bench-${Date.now()}@example.com`;

const log = (message) => console.log(`bench: ${message}`);

// --- statistics -------------------------------------------------------------

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index];
}

function summarise(name, budgetMs, samples, errors) {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (value) => Math.round(value * 10) / 10;
  const p95 = round(percentile(sorted, 0.95));
  return {
    name,
    budgetMs,
    samples: samples.length,
    errors,
    min: round(sorted[0] ?? 0),
    p50: round(percentile(sorted, 0.5)),
    p95,
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1] ?? 0),
    withinBudget: budgetMs === null || p95 <= budgetMs,
  };
}

// --- HTTP -------------------------------------------------------------------

let cookie = "";

const API_BASE_PATH = "/api/v1";

/** Paths are relative to the versioned API unless they name another mount, like `/api/auth`. */
async function request(path, init = {}) {
  const url = path.startsWith("/api/") ? path : `${API_BASE_PATH}${path}`;
  const response = await fetch(`${baseUrl}${url}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      origin: baseUrl,
      ...init.headers,
    },
  });
  return response;
}

async function json(path, init) {
  const response = await request(path, init);
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} → ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

/** Time one request end to end, including reading the body: that is what a client waits. */
async function timed(path, init) {
  const started = performance.now();
  const response = await request(path, init);
  await response.arrayBuffer();
  const elapsed = performance.now() - started;
  return { elapsed, ok: response.ok, status: response.status };
}

/**
 * `concurrency` workers pulling from one queue of iterations. Each iteration builds its
 * own request, so a scenario can walk a list of ids without two workers colliding.
 */
async function run(scenario) {
  const iterations = scenario.iterations ?? ITERATIONS;
  const concurrency = scenario.concurrency ?? CONCURRENCY;
  const samples = [];
  let errors = 0;
  let next = 0;

  const worker = async (measuring) => {
    for (;;) {
      const index = next++;
      if (index >= (measuring ? iterations : WARMUP)) return;
      // Warm-up iterations are numbered past the measured range so a mutation scenario
      // never spends its warm-up on the rows it is about to measure — completing an
      // already-completed task is a no-op and would flatter the numbers.
      const call = scenario.request(measuring ? index : iterations + index);
      const result = await timed(call.path, call.init);
      if (!result.ok) {
        errors += 1;
        if (errors <= 3) {
          console.error(`bench: ${scenario.name} ${call.path} → ${result.status}`);
        }
        continue;
      }
      if (measuring) samples.push(result.elapsed);
    }
  };

  // Warm up first: the first hit on a route pays for a cold connection pool and an empty
  // plan cache, which is not what a user experiences on their tenth click.
  next = 0;
  await Promise.all(Array.from({ length: concurrency }, () => worker(false)));
  next = 0;
  await Promise.all(Array.from({ length: concurrency }, () => worker(true)));

  const result = summarise(scenario.name, scenario.budgetMs, samples, errors);
  const verdict = result.withinBudget ? "ok " : "OVER";
  log(
    `${verdict} ${result.name.padEnd(22)} p50 ${String(result.p50).padStart(7)} ms  ` +
      `p95 ${String(result.p95).padStart(7)} ms  p99 ${String(result.p99).padStart(7)} ms  ` +
      `(${result.budgetMs === null ? "runner baseline" : `budget ${result.budgetMs} ms`}, n=${result.samples}, errors=${result.errors})`,
  );
  return result;
}

// --- server lifecycle -------------------------------------------------------

let server;

async function waitForServer(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error("server did not become healthy");
    await delay(500);
  }
}

function startServer() {
  log(`starting the production server on ${baseUrl}`);
  server = spawn("pnpm", ["--filter", "@morrowlist/web", "start"], {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      DATABASE_URL: databaseUrl,
      APP_URL: baseUrl,
      AUTH_TRUSTED_ORIGINS: baseUrl,
      // The reminder loop would otherwise poll the same database mid-measurement.
      WORKER_MODE: "off",
      LOG_LEVEL: "warn",
    },
  });
}

function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  server = undefined;
}

function seed(workspaceEmail) {
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      [
        "scripts/seed-scale.mjs",
        "--database-url",
        databaseUrl,
        "--email",
        workspaceEmail,
        "--scale",
        values.scale,
        "--json",
      ],
      { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.on("error", fail);
    child.on("exit", (code) => {
      if (code !== 0) return fail(new Error(`seed-scale exited with ${code}`));
      const lines = output.trim().split("\n");
      done(JSON.parse(lines[lines.length - 1]));
    });
  });
}

// --- the run ----------------------------------------------------------------

try {
  if (!externalServer) {
    const handle = database.createDatabase({
      connectionString: databaseUrl,
      max: 1,
      applicationName: "morrowlist-bench-setup",
    });
    try {
      await database.migrate({ pool: handle.pool });
      await database.truncateAll(handle);
    } finally {
      await handle.close();
    }
    log("migrated and truncated the benchmark database");
    startServer();
  }
  await waitForServer();

  // Sign up first, then seed into the workspace the sign-up created, so the benchmark
  // drives a real session against real data rather than a synthetic actor.
  const signUp = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name: "Bench", email, password: PASSWORD }),
  });
  if (!signUp.ok)
    throw new Error(`sign-up failed: ${signUp.status} ${await signUp.text()}`);
  cookie = (signUp.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error("sign-up returned no session cookie");
  log(`signed up ${email}`);

  let summary;
  if (values["skip-seed"]) {
    log("--skip-seed: assuming the database is already at scale");
  } else {
    summary = await seed(email);
  }

  const me = await json("/me");
  const workspaceId = me.data.workspaces[0].id;
  const ws = `workspaceId=${workspaceId}`;

  const projects = await json(`/projects?${ws}&limit=100`);
  const boardProjectId = summary?.boardProjectId ?? projects.data[0].id;
  const tags = await json(`/tags?${ws}`);
  const tagId = summary?.tagId ?? tags.data[0].id;
  const searchTerm = summary?.searchTerm ?? "kanban";

  // Pools the scenarios walk: a task id per iteration, so no two iterations touch the
  // same row and a mutation never repeats a no-op.
  const inboxPage = await json(`/tasks?${ws}&inbox=true&limit=100`);
  const readTaskId = inboxPage.data[0].id;
  const heavyTaskId =
    summary?.activityTaskId ??
    (await json(`/tasks?${ws}&limit=1&sort=createdAt&order=asc`)).data[0].id;

  const mutable = [];
  let cursor;
  while (mutable.length < Math.max(200, MUTATION_ITERATIONS * 3)) {
    const page = await json(
      `/tasks?${ws}&inbox=true&limit=100${cursor ? `&cursor=${cursor}` : ""}`,
    );
    for (const task of page.data) if (!task.completedAt) mutable.push(task.id);
    cursor = page.page?.nextCursor;
    if (!cursor) break;
  }
  log(`${mutable.length} inbox tasks available for the mutation scenarios`);
  if (mutable.length < 200)
    throw new Error("benchmark needs at least 200 mutable tasks");

  const boardStatuses = await json(`/projects/${boardProjectId}/statuses?${ws}`);
  const targetStatus = boardStatuses.data.find((status) => !status.isTerminal);

  const scenarios = [
    // Spec 29.2: common API reads, p95 under 300 ms.
    {
      name: "inbox",
      budgetMs: 300,
      request: () => ({ path: `/tasks?${ws}&inbox=true&limit=50` }),
    },
    { name: "today", budgetMs: 300, request: () => ({ path: `/views/today?${ws}` }) },
    {
      name: "upcoming",
      budgetMs: 300,
      request: () => ({ path: `/views/upcoming?${ws}&horizon=14` }),
    },
    {
      name: "board",
      budgetMs: 300,
      request: () => ({ path: `/projects/${boardProjectId}/board?${ws}` }),
    },
    {
      name: "list filtered",
      budgetMs: 300,
      request: () => ({
        path: `/tasks?${ws}&projectId=${boardProjectId}&priority=high&includeSubtasks=false&limit=50`,
      }),
    },
    {
      name: "list by tag",
      budgetMs: 300,
      request: () => ({ path: `/tasks?${ws}&tagId=${tagId}&limit=50` }),
    },
    {
      name: "completed history",
      budgetMs: 300,
      request: () => ({
        path: `/tasks?${ws}&isCompleted=true&sort=updatedAt&order=desc&limit=50`,
      }),
    },
    {
      name: "task detail",
      budgetMs: 300,
      request: () => ({ path: `/tasks/${readTaskId}?${ws}` }),
    },
    {
      name: "activity page",
      budgetMs: 300,
      request: () => ({ path: `/tasks/${heavyTaskId}/activity?${ws}&limit=50` }),
    },
    // Spec 29.2: search, first page under 500 ms.
    {
      name: "search",
      budgetMs: 500,
      request: () => ({ path: `/search?${ws}&q=${searchTerm}&limit=25` }),
    },
    // Spec 29.2: common task mutations, p95 under 500 ms.
    {
      name: "create task",
      budgetMs: 500,
      iterations: MUTATION_ITERATIONS,
      request: (index) => ({
        path: `/tasks?${ws}`,
        init: {
          method: "POST",
          body: JSON.stringify({ title: `Benchmark capture ${index}` }),
        },
      }),
    },
    {
      name: "update task",
      budgetMs: 500,
      iterations: MUTATION_ITERATIONS,
      request: (index) => ({
        path: `/tasks/${mutable[index % mutable.length]}?${ws}`,
        init: {
          method: "PATCH",
          body: JSON.stringify({ priority: index % 2 === 0 ? "high" : "low" }),
        },
      }),
    },
    {
      name: "move task",
      budgetMs: 500,
      iterations: MUTATION_ITERATIONS,
      request: (index) => ({
        path: `/tasks/${mutable[mutable.length - 1 - index]}/move?${ws}`,
        init: {
          method: "POST",
          body: JSON.stringify({
            projectId: boardProjectId,
            statusId: targetStatus.id,
          }),
        },
      }),
    },
    // A maximum-size batch is 200 mutations, not spec 29.2's common single mutation.
    // Run serially on a fixed set, alternating priority so every operation writes.
    // The nightly workflow retains p95 and compares it to the prior runner result.
    {
      name: "batch priority (200)",
      budgetMs: null,
      iterations: 20,
      concurrency: 1,
      request: (index) => ({
        path: `/tasks/batch?${ws}`,
        init: {
          method: "POST",
          body: JSON.stringify({
            operations: mutable.slice(0, 200).map((taskId) => ({
              op: "setPriority",
              taskId,
              priority: index % 2 === 0 ? "high" : "low",
            })),
          }),
        },
      }),
    },
    {
      name: "complete task",
      budgetMs: 500,
      iterations: MUTATION_ITERATIONS,
      request: (index) => ({
        path: `/tasks/${mutable[index]}/complete?${ws}`,
        init: { method: "POST", body: JSON.stringify({}) },
      }),
    },
  ];

  const results = [];
  for (const scenario of scenarios) results.push(await run(scenario));

  // A benchmark number without the machine it was taken on is folklore. The load average
  // is recorded because a shared machine inflates every figure here, and a reader who
  // sees a busy one knows to treat the numbers as an upper bound.
  const report = {
    takenAt: new Date().toISOString(),
    scale: values.scale,
    concurrency: CONCURRENCY,
    iterations: ITERATIONS,
    machine: {
      // Linux ARM may omit the model name; CI supplies its /proc/cpuinfo identity.
      cpu: process.env.BENCH_CPU_IDENTITY || cpus()[0]?.model || "unknown",
      cores: cpus().length,
      memoryBytes: totalmem(),
      os: `${type()} ${release()}`,
      node: process.version,
      loadAverage: loadavg().map((value) => Math.round(value * 100) / 100),
    },
    dataset: summary ?? null,
    results,
  };
  log(
    `machine ${report.machine.cpu}, ${report.machine.cores} cores, ` +
      `load average ${report.machine.loadAverage.join(" / ")}`,
  );

  if (values.out) {
    await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`);
    log(`wrote ${values.out}`);
  }

  const over = results.filter((result) => !result.withinBudget);
  if (over.length > 0) {
    console.error(
      `bench: ${over.length} scenario(s) over the spec 29.2 budget: ${over
        .map((result) => `${result.name} p95 ${result.p95} ms > ${result.budgetMs} ms`)
        .join("; ")}`,
    );
  }

  let regressed = [];
  if (values.check) {
    const baseline = JSON.parse(await readFile(values.check, "utf8"));
    const allowed = 1 + Number(values.regression) / 100;
    const byName = new Map(baseline.results.map((result) => [result.name, result]));
    regressed = results.filter((result) => {
      const previous = byName.get(result.name);
      return previous && result.p95 > previous.p95 * allowed;
    });
    for (const result of regressed) {
      console.error(
        `bench: ${result.name} p95 ${result.p95} ms is more than ${values.regression}% ` +
          `slower than the baseline ${byName.get(result.name).p95} ms`,
      );
    }
  }

  stopServer();
  if (
    over.length > 0 ||
    regressed.length > 0 ||
    results.some((result) => result.errors > 0)
  )
    process.exit(1);
} finally {
  stopServer();
}
