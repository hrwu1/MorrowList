import {
  ExportService,
  ImportService,
  ProjectService,
  TagService,
  TaskService,
  bootstrapUser,
  type ActorContext,
  type UnitOfWork,
} from "@morrowlist/application";
import { fixedClock, parseCsv, uuidv7 } from "@morrowlist/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseHandle } from "../client.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  truncateAll,
} from "../test-harness.js";
import { createUnitOfWork } from "../unit-of-work.js";

/**
 * Export and import against real PostgreSQL (GAP-07, spec 30).
 *
 * The in-memory suite proves the mapping; this proves the SQL: that the archive walks a
 * workspace bigger than one page without a gap or a repeat, that it stays inside the read
 * budget at MVP scale (spec 29.2), and that an import is one transaction that either
 * commits whole or leaves nothing behind.
 */

const NOW = new Date("2026-09-05T09:00:00.000Z");
/** Spec 29.1's scale target for a personal workspace. */
const LARGE_WORKSPACE = 10_000;
const EXPORT_BUDGET_MS = 60_000;

let handle: DatabaseHandle;
let unitOfWork: UnitOfWork;
let context: ActorContext;
let workspaceId: string;
let projectId: string;
let exportService: ExportService;
let importService: ImportService;
let tasks: TaskService;
let tags: TagService;
let projects: ProjectService;

beforeAll(async () => {
  handle = await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await truncateAll(handle);
  unitOfWork = createUnitOfWork(handle);
  const userId = uuidv7();
  const { workspace } = await bootstrapUser(
    { unitOfWork, clock: fixedClock(NOW) },
    {
      userId,
      email: "export-integration@example.com",
      displayName: "Export Integration",
      timezone: "Europe/Berlin",
      taskKeyPrefix: "ML",
    },
  );
  workspaceId = workspace.id;
  context = {
    actorKind: "user",
    actorId: userId,
    userId,
    actorDisplayName: "Export Integration",
    workspaceIds: [workspaceId],
    scopes: new Set(),
    requestId: "req_export_integration",
  };

  exportService = new ExportService({ unitOfWork, clock: fixedClock(NOW) });
  importService = new ImportService({ unitOfWork, clock: fixedClock(NOW) });
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "integration-cursor-secret",
  });
  tags = new TagService({ unitOfWork, clock: fixedClock(NOW) });
  projects = new ProjectService({ unitOfWork, clock: fixedClock(NOW) });

  const created = await projects.create(context, { workspaceId, name: "Relaunch" });
  projectId = created.project.id;
});

/** Insert `count` tasks in one statement per batch; the services are too slow at scale. */
async function seedTasks(count: number): Promise<void> {
  const ready = (await projects.get(context, workspaceId, projectId)).statuses.find(
    (status) => status.isDefault,
  );
  const batch = 500;
  for (let start = 0; start < count; start += batch) {
    await Promise.all(
      Array.from({ length: Math.min(batch, count - start) }, (_unused, index) =>
        tasks.create(context, {
          workspaceId,
          title: `Task ${start + index}`,
          projectId,
          statusId: ready?.id,
        }),
      ),
    );
  }
}

describe("workspace export against PostgreSQL", () => {
  it("produces every section from real rows, with every association", async () => {
    const research = await tags.create(context, workspaceId, { name: "Research" });
    const parent = await tasks.create(context, {
      workspaceId,
      title: "Draft the brief",
      projectId,
      dueDate: "2026-09-15",
      deferUntil: "2026-09-10",
      deadline: "2026-09-20",
    });
    const child = await tasks.create(context, {
      workspaceId,
      title: "Collect examples",
      parentTaskId: parent.id,
    });
    await tasks.addTag(context, workspaceId, parent.id, research.id);
    await tasks.addToDay(context, workspaceId, parent.id, { date: "2026-09-05" });
    await tasks.addRelation(context, workspaceId, child.id, {
      type: "blocks",
      targetTaskId: parent.id,
    });

    const archive = await exportService.workspace(context, workspaceId);

    // The schema itself is checked in the contracts and application suites; here the
    // point is that PostgreSQL produced every section, in the shape the schema names.
    expect(archive.format).toBe("morrowlist-export");
    expect(archive.schemaVersion).toBe(1);
    expect(Object.keys(archive)).toEqual([
      "format",
      "schemaVersion",
      "exportedAt",
      "workspace",
      "projects",
      "statuses",
      "tasks",
      "tags",
      "taskTags",
      "relations",
      "dayPlans",
      "savedViews",
      "activity",
    ]);
    expect(archive.tasks).toHaveLength(2);
    expect(archive.taskTags).toEqual([{ taskId: parent.id, tagId: research.id }]);
    expect(archive.dayPlans).toEqual([{ taskId: parent.id, planDate: "2026-09-05" }]);
    expect(archive.relations).toHaveLength(1);
    expect(archive.statuses).toHaveLength(6);
    expect(archive.activity.length).toBeGreaterThan(0);
  });

  it(
    "walks a ten-thousand-task workspace once, with no gap and no repeat",
    { timeout: 600_000 },
    async () => {
      await seedTasks(LARGE_WORKSPACE);

      const started = Date.now();
      const archive = await exportService.workspace(context, workspaceId, {
        activity: "none",
      });
      const elapsed = Date.now() - started;

      expect(archive.tasks).toHaveLength(LARGE_WORKSPACE);
      expect(new Set(archive.tasks.map((task) => task.id)).size).toBe(LARGE_WORKSPACE);
      expect(new Set(archive.tasks.map((task) => task.taskNumber)).size).toBe(
        LARGE_WORKSPACE,
      );
      expect(elapsed).toBeLessThan(EXPORT_BUDGET_MS);
    },
  );

  it("carries no auth material", async () => {
    await tasks.create(context, { workspaceId, title: "Something" });

    const serialized = JSON.stringify(
      await exportService.workspace(context, workspaceId),
    );

    expect(serialized).not.toContain("export-integration@example.com");
    for (const forbidden of [
      '"passwordHash"',
      '"sessionToken"',
      '"p256dh"',
      '"keys"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("exports a filtered task CSV that the importer reads back", async () => {
    const research = await tags.create(context, workspaceId, { name: "Research" });
    const parent = await tasks.create(context, {
      workspaceId,
      title: 'A "quoted", comma title',
      projectId,
      dueDate: "2026-09-15",
    });
    await tasks.addTag(context, workspaceId, parent.id, research.id);
    await tasks.create(context, {
      workspaceId,
      title: "Inbox only",
    });

    const csv = await exportService.tasksCsv(context, {
      workspaceId,
      projectId,
      includeSubtasks: true,
      sort: "rank",
      order: "asc",
    });
    const rows = parseCsv(csv);

    expect(rows[0]?.[0]).toBe("key");
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[1]).toBe('A "quoted", comma title');
    expect(rows[1]?.[3]).toBe("Ready");
    expect(rows[1]?.[8]).toBe("Research");

    const applied = await importService.apply(context, workspaceId, "csv", {
      content: csv,
      projectName: "Round trip",
    });
    const roundTripped = await tasks.list(context, {
      workspaceId,
      projectId: applied.projectId!,
      limit: 50,
      includeSubtasks: true,
      sort: "rank",
      order: "asc",
    });
    expect(roundTripped.data.map((task) => task.title)).toEqual([
      'A "quoted", comma title',
    ]);
    expect(roundTripped.data[0]?.tags.map((tag) => tag.name)).toEqual(["Research"]);
  });
});

describe("import against PostgreSQL", () => {
  const csv = [
    "key,title,status,tags,parentKey,completed",
    "T-1,Parent task,Ready,ops,,",
    "T-2,Child task,Ready,,T-1,yes",
    "T-3,Finished,Done,,,",
  ].join("\n");

  it("commits the project, its columns, its tags, and its tasks together", async () => {
    const result = await importService.apply(context, workspaceId, "csv", {
      content: csv,
      projectName: "Imported",
    });

    const detail = await projects.get(context, workspaceId, result.projectId!);
    expect(detail.statuses.map((status) => status.name)).toEqual(["Ready", "Done"]);

    const listed = await tasks.list(context, {
      workspaceId,
      projectId: result.projectId!,
      limit: 50,
      includeSubtasks: true,
      sort: "rank",
      order: "asc",
    });
    const byTitle = new Map(listed.data.map((task) => [task.title, task]));
    expect(byTitle.get("Child task")?.parentTaskId).toBe(
      byTitle.get("Parent task")?.id,
    );
    expect(byTitle.get("Child task")?.isCompleted).toBe(true);
    expect(byTitle.get("Finished")?.isCompleted).toBe(true);
    expect(byTitle.get("Parent task")?.tags.map((tag) => tag.name)).toEqual(["ops"]);

    // Flow intervals come from the same path as capture, so metrics work immediately.
    const flow = await unitOfWork.execute((tx) =>
      tx.statusIntervals.listForTasks(workspaceId, [
        byTitle.get("Parent task")?.id as string,
      ]),
    );
    expect(flow.length).toBeGreaterThan(0);
  });

  it("leaves nothing behind when a constraint rejects part of the import", async () => {
    const before = await unitOfWork.execute(async (tx) => ({
      projects: (await tx.projects.listByWorkspace(workspaceId)).length,
      tags: (await tx.tags.listByWorkspace(workspaceId)).length,
    }));

    // The first row is fine; the second names a tag longer than a tag may be, and the
    // whole import must roll back rather than leave a project with half its tasks.
    await expect(
      importService.apply(context, workspaceId, "csv", {
        content: ["title,tags", "Fine,ops", `Broken,${"x".repeat(200)}`].join("\n"),
        projectName: "Half written",
      }),
    ).rejects.toThrow();

    const after = await unitOfWork.execute(async (tx) => ({
      projects: (await tx.projects.listByWorkspace(workspaceId)).length,
      tags: (await tx.tags.listByWorkspace(workspaceId)).length,
      tasks: (await tx.tasks.list({ workspaceId }, { limit: 100 })).items.length,
    }));
    expect(after.projects).toBe(before.projects);
    expect(after.tags).toBe(before.tags);
    expect(after.tasks).toBe(0);
  });

  it("dry runs without writing", async () => {
    const result = await importService.preview(context, workspaceId, "csv", {
      content: csv,
    });

    expect(result.projectId).toBeNull();
    const listed = await unitOfWork.execute((tx) =>
      tx.projects.listByWorkspace(workspaceId),
    );
    expect(listed.map((project) => project.name)).toEqual(["Relaunch"]);
  });
});
