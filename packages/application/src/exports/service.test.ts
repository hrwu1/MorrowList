import { workspaceExportSchema } from "@morrowlist/contracts";
import { fixedClock, parseCsv, planFromCsv } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { FieldService } from "../fields/service.js";
import { SavedViewService } from "../saved-views/service.js";
import { TagService } from "../tags/service.js";
import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  statusByCategory,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { ExportService } from "./service.js";

const NOW = new Date("2026-09-05T09:00:00.000Z");
const CURSOR_SECRET = "test-cursor-secret";

let unitOfWork: InMemoryUnitOfWork;
let seeded: SeededWorkspace;
let exports: ExportService;
let tasks: TaskService;
let tags: TagService;
let views: SavedViewService;
let fields: FieldService;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  exports = new ExportService({ unitOfWork, clock: fixedClock(NOW) });
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: CURSOR_SECRET,
  });
  tags = new TagService({ unitOfWork, clock: fixedClock(NOW) });
  views = new SavedViewService({ unitOfWork, clock: fixedClock(NOW) });
  fields = new FieldService({ unitOfWork, clock: fixedClock(NOW) });
});

const workspaceId = () => seeded.workspace.id;

/** A workspace using every feature the archive has to carry. */
async function seedEverything() {
  const ready = statusByCategory(seeded.statuses, "ready");
  const research = await tags.create(seeded.context, workspaceId(), {
    name: "Research",
  });

  // Typed custom fields travel too (GAP-24): the definitions in their own section, the
  // values on the task that carries them.
  const stage = await fields.create(seeded.context, workspaceId(), {
    name: "Stage",
    type: "select",
    options: ["Discovery", "Delivery"],
  });
  const effort = await fields.create(seeded.context, workspaceId(), {
    name: "Effort",
    type: "number",
  });

  const parent = await tasks.create(seeded.context, {
    workspaceId: workspaceId(),
    title: "Draft the brief",
    fields: { stage: "Discovery", effort: 3 },
    projectId: seeded.project.id,
    statusId: ready.id,
    dueDate: "2026-09-15",
    dueTime: "09:30",
    dueTimezone: "Europe/Berlin",
    deferUntil: "2026-09-10",
    deadline: "2026-09-20",
    deadlineTime: "17:00",
    recurrence: {
      freq: "weekly",
      interval: 1,
      mode: "schedule",
      weekdays: ["mon"],
      monthDay: null,
      nthWeekday: null,
      until: null,
      count: null,
    },
  });
  const child = await tasks.create(seeded.context, {
    workspaceId: workspaceId(),
    title: "Collect examples",
    parentTaskId: parent.id,
  });
  const blocker = await tasks.create(seeded.context, {
    workspaceId: workspaceId(),
    title: "Wait on legal",
  });

  await tasks.addTag(seeded.context, workspaceId(), parent.id, research.id);
  await tasks.addToDay(seeded.context, workspaceId(), parent.id, {
    date: "2026-09-05",
  });
  await tasks.addRelation(seeded.context, workspaceId(), blocker.id, {
    type: "blocks",
    targetTaskId: parent.id,
  });
  await tasks.setBlocked(seeded.context, workspaceId(), blocker.id, {
    reason: "waiting on legal",
  });
  const trashed = await tasks.create(seeded.context, {
    workspaceId: workspaceId(),
    title: "Abandoned idea",
  });
  await tasks.delete(seeded.context, workspaceId(), trashed.id);
  await views.create(seeded.context, workspaceId(), {
    name: "Overdue",
    filters: { due: "overdue" },
    layout: "list",
  });

  return { parent, child, blocker, trashed, research, stage, effort };
}

describe("ExportService.workspace", () => {
  it("validates against the published schema and carries every section", async () => {
    const { parent, child, blocker, trashed, research } = await seedEverything();

    const archive = await exports.workspace(seeded.context, workspaceId());

    expect(workspaceExportSchema.safeParse(archive).success).toBe(true);
    expect(archive.format).toBe("morrowlist-export");
    expect(archive.schemaVersion).toBe(1);
    expect(archive.exportedAt).toBe(NOW.toISOString());
    expect(archive.workspace.taskKeyPrefix).toBe("ML");
    expect(archive.projects.map((project) => project.id)).toEqual([seeded.project.id]);
    expect(archive.statuses).toHaveLength(seeded.statuses.length);

    // Trashed tasks travel too: the Trash is state, not absence (spec 9.7).
    expect(archive.tasks.map((task) => task.title).sort()).toEqual([
      "Abandoned idea",
      "Collect examples",
      "Draft the brief",
      "Wait on legal",
    ]);
    const exported = new Map(archive.tasks.map((task) => [task.id, task]));
    expect(exported.get(trashed.id)?.deletedAt).not.toBeNull();
    expect(exported.get(child.id)?.parentTaskId).toBe(parent.id);
    expect(exported.get(blocker.id)?.blockedReason).toBe("waiting on legal");

    const draft = exported.get(parent.id);
    expect(draft).toMatchObject({
      key: "ML-000001",
      dueDate: "2026-09-15",
      dueTime: "09:30",
      deferUntil: "2026-09-10",
      deadline: "2026-09-20",
      deadlineTime: "17:00",
      reminderOffsetMinutes: 30,
    });
    expect(draft?.recurrence?.freq).toBe("weekly");
    expect(draft?.seriesId).toBe(parent.id);
    expect(draft?.rank.length).toBeGreaterThan(0);

    expect(archive.tags.map((tag) => tag.name)).toEqual(["Research"]);
    expect(archive.taskTags).toEqual([{ taskId: parent.id, tagId: research.id }]);
    expect(archive.relations).toHaveLength(1);
    expect(archive.relations[0]).toMatchObject({
      sourceTaskId: blocker.id,
      targetTaskId: parent.id,
      type: "blocks",
    });
    expect(archive.dayPlans).toEqual([{ taskId: parent.id, planDate: "2026-09-05" }]);
    // The definitions and the values are both present: a restore needs the type and the
    // select's options, not only the cell (GAP-24).
    expect(
      archive.fields.map((field) => [field.key, field.type, field.options]),
    ).toEqual([
      ["stage", "select", ["Discovery", "Delivery"]],
      ["effort", "number", []],
    ]);
    expect(draft?.fields).toEqual({ stage: "Discovery", effort: 3 });
    expect(exported.get(blocker.id)?.fields).toEqual({});
    expect(archive.savedViews.map((view) => view.name)).toEqual(["Overdue"]);
    expect(archive.activity.length).toBeGreaterThan(0);
  });

  it("carries no auth material and no derived table", async () => {
    await seedEverything();

    const archive = await exports.workspace(seeded.context, workspaceId());
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          keys.add(key);
          walk(nested);
        }
      }
    };
    walk(archive);

    for (const forbidden of [
      "password",
      "passwordHash",
      "sessionToken",
      "apiKey",
      "secret",
      "p256dh",
      "endpoint",
      "keys",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    // Rebuilt after a restore rather than shipped: they are read models, not truth.
    expect(archive).not.toHaveProperty("intervals");
    expect(archive).not.toHaveProperty("reminders");
  });

  it("narrows history to tasks, or drops it entirely, on request", async () => {
    await seedEverything();

    const all = await exports.workspace(seeded.context, workspaceId(), {
      activity: "all",
    });
    const taskOnly = await exports.workspace(seeded.context, workspaceId(), {
      activity: "tasks",
    });
    const none = await exports.workspace(seeded.context, workspaceId(), {
      activity: "none",
    });

    expect(all.activity.some((event) => event.aggregateType !== "task")).toBe(true);
    expect(taskOnly.activity.every((event) => event.aggregateType === "task")).toBe(
      true,
    );
    expect(taskOnly.activity.length).toBeLessThan(all.activity.length);
    expect(none.activity).toEqual([]);
    // Turning history off changes nothing else about the archive.
    expect(none.tasks).toEqual(all.tasks);
  });

  it("refuses a workspace the caller cannot reach", async () => {
    await expect(
      exports.workspace({ ...seeded.context, workspaceIds: [] }, workspaceId()),
    ).rejects.toThrow(/Workspace not found/);
  });

  it("pages through a workspace larger than one repository read", async () => {
    for (let index = 0; index < 620; index++) {
      await tasks.create(seeded.context, {
        workspaceId: workspaceId(),
        title: `Task ${index}`,
      });
    }

    const archive = await exports.workspace(seeded.context, workspaceId(), {
      activity: "none",
    });

    expect(archive.tasks).toHaveLength(620);
    expect(new Set(archive.tasks.map((task) => task.id)).size).toBe(620);
  });
});

describe("ExportService.tasksCsv", () => {
  it("writes the documented columns and re-imports through the CSV mapper", async () => {
    const { parent } = await seedEverything();

    const csv = await exports.tasksCsv(seeded.context, {
      workspaceId: workspaceId(),
      includeSubtasks: true,
      sort: "rank",
      order: "asc",
    });
    const rows = parseCsv(csv);

    expect(rows[0]).toEqual([
      "key",
      "title",
      "description",
      "status",
      "priority",
      "dueDate",
      "deadline",
      "deferUntil",
      "tags",
      "parentKey",
      "completed",
      // One column per definition, appended so the fixed columns keep their positions.
      "field:stage",
      "field:effort",
    ]);
    const draft = rows.find((row) => row[1] === "Draft the brief");
    expect(draft?.[0]).toBe("ML-000001");
    // The column's name, not its id: a person reads it and the importer matches on it.
    expect(draft?.[3]).toBe("Ready");
    expect(draft?.[5]).toBe("2026-09-15");
    expect(draft?.[8]).toBe("Research");
    expect(rows.find((row) => row[1] === "Collect examples")?.[9]).toBe("ML-000001");
    expect(draft?.slice(11)).toEqual(["Discovery", "3"]);

    // The archive's own CSV is a valid import: the round trip closes.
    const plan = planFromCsv(csv, { projectName: "Round trip" });
    expect(plan.tasks.map((task) => task.title)).toContain("Draft the brief");
    expect(
      plan.tasks.find((task) => task.title === "Draft the brief")?.subtasks,
    ).toEqual([
      { title: "Collect examples", isCompleted: false, externalId: "ML-000002" },
    ]);
    expect(plan.tasks.find((task) => task.title === "Draft the brief")?.fields).toEqual(
      { stage: "Discovery", effort: "3" },
    );
    expect(parent.key).toBe("ML-000001");
  });

  it("honours the list filter, so a person exports what they are looking at", async () => {
    await seedEverything();

    const inbox = await exports.tasksCsv(seeded.context, {
      workspaceId: workspaceId(),
      inbox: true,
      includeSubtasks: true,
      sort: "rank",
      order: "asc",
    });

    const titles = parseCsv(inbox)
      .slice(1)
      .map((row) => row[1]);
    expect(titles).toContain("Wait on legal");
    expect(titles).not.toContain("Draft the brief");
  });

  it("quotes a title that would otherwise break a record", async () => {
    await tasks.create(seeded.context, {
      workspaceId: workspaceId(),
      title: 'A "quoted", comma title',
    });

    const csv = await exports.tasksCsv(seeded.context, {
      workspaceId: workspaceId(),
      includeSubtasks: true,
      sort: "rank",
      order: "asc",
    });

    expect(csv).toContain('"A ""quoted"", comma title"');
    expect(parseCsv(csv)[1]?.[1]).toBe('A "quoted", comma title');
  });
});
