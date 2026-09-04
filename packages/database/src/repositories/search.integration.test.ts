import {
  ProjectService,
  TagService,
  TaskService,
  bootstrapUser,
  type ActorContext,
  type Cursor,
  type TaskSearchQuery,
} from "@morrowlist/application";
import { fixedClock, searchTerms, uuidv7 } from "@morrowlist/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Database, DatabaseHandle } from "../client.js";
import * as schema from "../schema/index.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

import { createTaskRepository } from "./tasks.js";

/**
 * Search and saved views against real PostgreSQL (GAP-02, spec 9.8). Migration 0004
 * carries a generated tsvector column, a GIN index, a case-insensitive unique index and
 * a check constraint; none of those can be demonstrated by the in-memory doubles, and
 * the reference-scale budget (spec 29.2) only means something on a real planner.
 */

const NOW = new Date("2026-09-03T09:00:00.000Z");

let handle: DatabaseHandle;
let context: ActorContext;
let workspaceId: string;
let userId: string;
let tasks: TaskService;
let tagService: TagService;
let projects: ProjectService;
/** The statement Drizzle last sent, so a test can EXPLAIN exactly what shipped. */
let lastQuery: { sql: string; params: unknown[] } = { sql: "", params: [] };
let repository: ReturnType<typeof createTaskRepository>;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await truncateAll(handle);
  const unitOfWork = createUnitOfWork(handle);
  userId = uuidv7();
  const { workspace } = await bootstrapUser(
    { unitOfWork, clock: fixedClock(NOW) },
    {
      userId,
      email: "search-integration@example.com",
      displayName: "Search Integration",
      timezone: "UTC",
      taskKeyPrefix: "ML",
    },
  );
  workspaceId = workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "req_search_integration",
  };
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "search-integration-cursor-secret",
  });
  tagService = new TagService({ unitOfWork, clock: fixedClock(NOW) });
  projects = new ProjectService({ unitOfWork, clock: fixedClock(NOW) });
  const logged = drizzle(handle.pool, {
    schema,
    logger: {
      logQuery(sql, params) {
        lastQuery = { sql, params };
      },
    },
  });
  repository = createTaskRepository(logged as unknown as Database);
});

function search(
  text: string,
  overrides: Partial<TaskSearchQuery> = {},
  cursor: Cursor = { limit: 50 },
) {
  return repository.search(
    { workspaceId, terms: searchTerms(text), ...overrides },
    cursor,
  );
}

async function searchVectorOf(taskId: string): Promise<string> {
  const { rows } = await handle.pool.query<{ search_vector: string }>(
    "select search_vector::text from tasks where id = $1",
    [taskId],
  );
  return rows[0]?.search_vector ?? "";
}

async function insertSavedView(
  name: string,
  overrides: { ownerUserId?: string; layout?: string } = {},
) {
  const id = uuidv7();
  await handle.pool.query(
    `insert into saved_views (id, workspace_id, owner_user_id, name, filters, layout, rank, created_at, updated_at)
     values ($1, $2, $3, $4, '{}', $5, 'a0', now(), now())`,
    [
      id,
      workspaceId,
      overrides.ownerUserId ?? userId,
      name,
      overrides.layout ?? "list",
    ],
  );
  return id;
}

/**
 * Reference scale (spec 29.1): 10,000 tasks in one workspace, inserted in one statement
 * so the fixture costs well under a second. Every 97th title carries the needle.
 */
async function seedReferenceScale(): Promise<void> {
  await handle.pool.query(
    `insert into tasks (id, workspace_id, task_number, title, description_md, priority, rank,
       version, created_by_actor_kind, created_by_actor_id, last_actor_kind, last_actor_id,
       created_at, updated_at)
     select gen_random_uuid(), $1, n,
       case when n % 97 = 0 then 'Quarterly budget review ' || n else 'Routine task ' || n end,
       case when n % 250 = 0 then 'Needs the presentation deck from marketing' else null end,
       'none', 'a' || lpad(n::text, 8, '0'), 1, 'user', $2, 'user', $2, now(), now()
     from generate_series(1, 10000) as n`,
    [workspaceId, userId],
  );
}

describe("migration 0004", () => {
  it("keeps the search vector in step with the title and description", async () => {
    const task = await tasks.create(context, {
      workspaceId,
      title: "Prepare research presentation",
      descriptionMd: "Slides for the **lab meeting**",
    });

    const vector = await searchVectorOf(task.id);
    // Title lexemes carry weight A, description lexemes weight B (spec 9.8).
    expect(vector).toContain("'research':2A");
    expect(vector).toContain("'meeting':8B");

    await tasks.update(context, workspaceId, task.id, { title: "Rehearse the talk" });
    const updated = await searchVectorOf(task.id);
    expect(updated).toContain("'rehearse':1A");
    expect(updated).not.toContain("'research'");
  });

  it("refuses to write the generated column", async () => {
    await expect(
      handle.pool.query("update tasks set search_vector = to_tsvector('x')"),
    ).rejects.toThrow(/can only be updated to DEFAULT/);
  });

  it("indexes the search vector with GIN", async () => {
    const { rows } = await handle.pool.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where tablename = 'tasks' and indexname = 'tasks_search_idx'",
    );
    expect(rows[0]?.indexdef).toMatch(/USING gin \(search_vector\)/);
  });

  it("rejects a second view whose name differs only by case for the same owner", async () => {
    await insertSavedView("Overdue research");

    await expect(insertSavedView("OVERDUE RESEARCH")).rejects.toThrow(
      /saved_views_owner_name_key/,
    );
  });

  it("allows another owner in the workspace to use the same view name", async () => {
    await insertSavedView("Overdue research");

    await expect(
      insertSavedView("overdue research", { ownerUserId: uuidv7() }),
    ).resolves.toBeDefined();
  });

  it("only accepts the list and board layouts", async () => {
    await expect(insertSavedView("Bad", { layout: "grid" })).rejects.toThrow(
      /saved_views_layout_check/,
    );
  });

  it("removes a user's views when the workspace goes", async () => {
    await insertSavedView("Doomed");

    await handle.pool.query("delete from workspaces where id = $1", [workspaceId]);

    const { rows } = await handle.pool.query("select id from saved_views");
    expect(rows).toHaveLength(0);
  });

  it("answers a prefix search over 10,000 tasks through the index within budget", async () => {
    await seedReferenceScale();
    await handle.pool.query("analyze tasks");

    const started = performance.now();
    const page = await search("quarter budget", {}, { limit: 50 });
    const elapsed = performance.now() - started;
    console.log(`search first page over 10,000 tasks: ${elapsed.toFixed(1)} ms`);
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(elapsed).toBeLessThan(500);

    const { rows: plan } = await handle.pool.query<{ "QUERY PLAN": string }>(
      `explain (analyze, buffers) ${lastQuery.sql}`,
      lastQuery.params,
    );
    const planText = plan.map((row) => row["QUERY PLAN"]).join("\n");
    console.log(`search plan at reference scale:\n${planText}`);
    expect(planText).toMatch(/tasks_search_idx/);
  });
});

describe("task search", () => {
  it("prefix-matches every term, title hits before description hits, then newest first", async () => {
    const inDescription = await tasks.create(context, {
      workspaceId,
      title: "Slides",
      descriptionMd: "Draft the budget review deck",
    });
    const older = await tasks.create(context, {
      workspaceId,
      title: "Budget review with finance",
    });
    const newer = await tasks.create(context, { workspaceId, title: "Budget review" });
    await tasks.create(context, { workspaceId, title: "Budget only" });
    await tasks.create(context, { workspaceId, title: "Review only" });

    const page = await search("budg rev");
    expect(page.items.map((task) => task.id)).toEqual([
      newer.id,
      older.id,
      inDescription.id,
    ]);
    expect(page.hasMore).toBe(false);
  });

  it("matches a tag name and honours the list filters", async () => {
    const tag = await tagService.create(context, workspaceId, { name: "Deep Work" });
    const tagged = await tasks.create(context, { workspaceId, title: "Untitled" });
    await tasks.addTag(context, workspaceId, tagged.id, tag.id);
    const done = await tasks.create(context, { workspaceId, title: "Deep dive" });
    await tasks.complete(context, workspaceId, done.id);
    const deleted = await tasks.create(context, { workspaceId, title: "Deep sleep" });
    await tasks.delete(context, workspaceId, deleted.id);

    const all = await search("deep");
    expect(all.items.map((task) => task.title).sort()).toEqual([
      "Deep dive",
      "Untitled",
    ]);

    const open = await search("deep", { isCompleted: false });
    expect(open.items.map((task) => task.title)).toEqual(["Untitled"]);
  });

  it("pages with a keyset cursor on rank then id without skipping or repeating", async () => {
    const created = [];
    for (const title of ["Plan a", "Plan b", "Plan c", "Plan d", "Plan e"]) {
      created.push(await tasks.create(context, { workspaceId, title }));
    }

    const first = await search("plan", {}, { limit: 2 });
    const second = await search("plan", {}, { limit: 2, after: first.items[1]?.id });
    const third = await search("plan", {}, { limit: 2, after: second.items[1]?.id });

    const seen = [...first.items, ...second.items, ...third.items].map((t) => t.id);
    expect(new Set(seen).size).toBe(5);
    expect(seen.sort()).toEqual(created.map((task) => task.id).sort());
    expect([first.hasMore, second.hasMore, third.hasMore]).toEqual([true, true, false]);
  });

  it("filters blocked work by status category in both list and search", async () => {
    const { project, statuses } = await projects.create(context, {
      workspaceId,
      name: "Research",
    });
    const blocked = statuses.find((status) => status.category === "blocked");
    const ready = statuses.find((status) => status.category === "ready");
    const stuck = await tasks.create(context, {
      workspaceId,
      title: "Stuck experiment",
      projectId: project.id,
      statusId: blocked?.id,
    });
    await tasks.create(context, {
      workspaceId,
      title: "Moving experiment",
      projectId: project.id,
      statusId: ready?.id,
    });

    const listed = await tasks.list(context, {
      workspaceId,
      limit: 50,
      includeSubtasks: true,
      isBlocked: true,
      sort: "rank",
      order: "asc",
    } as never);
    expect(listed.data.map((task) => task.id)).toEqual([stuck.id]);

    const searched = await search("experiment", { isBlocked: false });
    expect(searched.items.map((task) => task.title)).toEqual(["Moving experiment"]);
  });

  it("returns every task that passes the filters when there are no terms", async () => {
    await tasks.create(context, { workspaceId, title: "One" });
    await tasks.create(context, { workspaceId, title: "Two" });

    const page = await search("");
    expect(page.items.map((task) => task.title)).toEqual(["Two", "One"]);
  });
});
