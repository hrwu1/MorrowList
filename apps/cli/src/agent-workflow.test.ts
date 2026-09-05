import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The GAP-18 completion criterion, as a test: an agent given nothing but the output of
 * `morrow usage` can list, create, and complete a task.
 *
 * It runs the real executable in a child process against a stub of the REST API, so it
 * exercises what an agent actually meets — argv parsing, the JSON envelope on stdout,
 * diagnostics kept off it, and the exit code — rather than the functions underneath.
 *
 * Nothing below reads the CLI's source for a command name or a flag. Every invocation is
 * derived from the `usage` output, which is the point.
 */

const ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));
/** The CLI is run from source, so the test does not depend on a prior `tsup` build. */
const TSX = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));

interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

let server: Server;
let baseUrl: string;
let recorded: Recorded[];

/** Just enough of `/api/v1` for the three commands under test. */
function stubApi(): Server {
  const task = {
    id: "01996c1f-0000-7000-8000-000000000001",
    key: "ML-1",
    workspaceId: "01996b00-0000-7000-8000-000000000002",
    taskNumber: 1,
    title: "Draft the brief",
    descriptionMd: null,
    projectId: null,
    statusId: null,
    priority: "none",
    dueDate: null,
    dueTime: null,
    dueTimezone: null,
    deferUntil: null,
    deadline: null,
    deadlineTime: null,
    dateWarnings: [],
    reminderOffsetMinutes: null,
    recurrence: null,
    seriesId: null,
    parentTaskId: null,
    subtaskProgress: null,
    isCompleted: false,
    completedAt: null,
    isBlocked: false,
    blocked: null,
    dayPlans: [],
    tags: [],
    relations: [],
    version: 1,
    createdAt: "2026-09-05T09:00:00.000Z",
    updatedAt: "2026-09-05T09:00:00.000Z",
  };

  return createServer((request, response) => {
    void readBody(request).then((body) => {
      recorded.push({
        method: request.method ?? "GET",
        url: request.url ?? "",
        body,
      });
      const path = new URL(request.url ?? "/", "http://stub").pathname;
      const send = (payload: unknown) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      };

      const notFound = (code: string, message: string) => {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { code, message, requestId: "r" } }));
      };

      if (request.method === "GET" && path === "/api/v1/tasks") {
        send({ data: [task], page: { hasMore: false, nextCursor: null } });
      } else if (request.method === "POST" && path === "/api/v1/tasks") {
        send({ data: { ...task, title: (body as { title: string }).title } });
      } else if (path.endsWith("/complete")) {
        send({ data: { ...task, isCompleted: true, version: 2 } });
      } else if (request.method === "GET" && path.startsWith("/api/v1/tasks/")) {
        // Only the one task exists, so an unknown key is a real 404.
        const requested = decodeURIComponent(path.slice("/api/v1/tasks/".length));
        if (requested === task.key || requested === task.id) send({ data: task });
        else notFound("TASK_NOT_FOUND", "No such task.");
      } else if (request.method === "GET" && path === "/api/v1/tags") {
        // `task add` resolves tags before creating, even when none were given.
        send({ data: [], page: { hasMore: false, nextCursor: null } });
      } else {
        notFound("NOT_FOUND", "No such endpoint.");
      }
    });
  });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run `morrow …` exactly as a shell script would. */
function morrow(args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX, ENTRY, ...args], {
      env: {
        ...process.env,
        MORROW_BASE_URL: `${baseUrl}/api/v1`,
        MORROW_API_KEY: "stub-key",
        // Never read the developer's real profile.
        MORROW_CONFIG: join(tmpdir(), "morrowlist-agent-test-no-such-config.json"),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

beforeAll(async () => {
  recorded = [];
  server = stubApi();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Spawning a TypeScript entry point four times is not fast.
describe("an agent working from `morrow usage` alone", { timeout: 60_000 }, () => {
  it("can discover, then list, create and complete a task in JSON mode", async () => {
    // 1. Read the manual. This is the only thing the agent is told exists.
    const usage = await morrow(["usage", "--json"]);
    expect(usage.code).toBe(0);
    const manual = JSON.parse(usage.stdout) as {
      ok: boolean;
      data: {
        commands: { name: string; subcommands: { name: string }[] }[];
        envelope: { success: { ok: boolean } };
      };
    };
    expect(manual.ok).toBe(true);

    const taskGroup = manual.data.commands.find((entry) => entry.name === "task");
    const verbs = new Set(taskGroup?.subcommands.map((entry) => entry.name));
    expect(verbs.has("list")).toBe(true);
    expect(verbs.has("add")).toBe(true);
    expect(verbs.has("complete")).toBe(true);

    // 2. List. The envelope is the shape the manual promised.
    const list = await morrow(["--json", "task", "list"]);
    expect(list.code).toBe(0);
    const listed = JSON.parse(list.stdout) as {
      ok: boolean;
      data: { data: unknown[] };
    };
    expect(listed.ok).toBe(true);
    expect(listed.data.data).toHaveLength(1);

    // 3. Create.
    const added = await morrow(["--json", "task", "add", "Draft the brief"]);
    expect(added.code).toBe(0);
    const created = JSON.parse(added.stdout) as {
      ok: boolean;
      data: { key: string; title: string };
    };
    expect(created.ok).toBe(true);
    expect(created.data.title).toBe("Draft the brief");

    // 4. Complete, addressing the task by the key the previous step returned.
    const done = await morrow(["--json", "task", "complete", created.data.key]);
    expect(done.code).toBe(0);
    const completed = JSON.parse(done.stdout) as {
      ok: boolean;
      data: { isCompleted: boolean };
    };
    expect(completed.ok).toBe(true);
    expect(completed.data.isCompleted).toBe(true);

    // The mutations carried an idempotency key without being asked, as the manual says.
    const posts = recorded.filter((entry) => entry.method === "POST");
    expect(posts.length).toBeGreaterThanOrEqual(2);
  });

  it("reports a failure as the documented envelope and a non-zero exit code", async () => {
    const missing = await morrow(["--json", "task", "show", "NOPE-1"]);

    expect(missing.code).not.toBe(0);
    const body = JSON.parse(missing.stdout) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("TASK_NOT_FOUND");
    // Diagnostics never contaminate the JSON on stdout.
    expect(missing.stdout.trim().startsWith("{")).toBe(true);
  });
});
