import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { TASK_EVENTS, WORKSPACE_EVENTS } from "@morrowlist/contracts";
import { DomainError, fixedClock } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { ProjectService } from "../projects/service.js";
import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { ImportService } from "./service.js";

/** A board exported from Trello, unedited apart from the identifiers. */
const TRELLO_BOARD = readFileSync(
  fileURLToPath(new URL("./fixtures/trello-board.json", import.meta.url)),
  "utf8",
);

const NOW = new Date("2026-09-05T09:00:00.000Z");
const CURSOR_SECRET = "test-cursor-secret";

let unitOfWork: InMemoryUnitOfWork;
let seeded: SeededWorkspace;
let imports: ImportService;
let tasks: TaskService;
let projects: ProjectService;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  imports = new ImportService({ unitOfWork, clock: fixedClock(NOW) });
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: CURSOR_SECRET,
  });
  projects = new ProjectService({ unitOfWork, clock: fixedClock(NOW) });
});

const workspaceId = () => seeded.workspace.id;

describe("ImportService.preview", () => {
  it("reports what a real Trello board would become, and writes nothing", async () => {
    const result = await imports.preview(seeded.context, workspaceId(), "trello", {
      content: TRELLO_BOARD,
    });

    expect(result.dryRun).toBe(true);
    expect(result.projectId).toBeNull();
    expect(result.preview.projectName).toBe("Website Relaunch");
    expect(result.preview.counts).toEqual({
      statuses: 5,
      tasks: 5,
      subtasks: 3,
      tags: 2,
      skipped: 0,
    });
    expect(
      result.preview.statuses.map((status) => [status.name, status.category]),
    ).toEqual([
      ["Backlog", "backlog"],
      ["This week", "ready"],
      ["Doing", "in_progress"],
      ["Waiting on client", "blocked"],
      ["Done", "done"],
    ]);
    expect(result.preview.tags).toEqual(["research", "content"]);
    expect(result.preview.ignoredFields).toContain("comments");

    expect(unitOfWork.data.projects.size).toBe(1);
    expect(unitOfWork.data.tasks.size).toBe(0);
    expect(unitOfWork.data.activity).toHaveLength(0);
  });

  it("refuses a file that is not the source it claims to be", async () => {
    await expect(
      imports.preview(seeded.context, workspaceId(), "trello", { content: "title\nx" }),
    ).rejects.toThrow(/not valid JSON/);
    await expect(
      imports.preview(seeded.context, workspaceId(), "trello", {
        content: '{"name":"Board"}',
      }),
    ).rejects.toThrow(/does not look like a Trello board/);
    await expect(
      imports.preview(seeded.context, workspaceId(), "csv", { content: "a,b\n1,2" }),
    ).rejects.toThrow(/needs a "title" column/);
  });

  it("refuses a workspace the caller cannot reach", async () => {
    await expect(
      imports.preview(
        { ...seeded.context, workspaceIds: [] },
        workspaceId(),
        "trello",
        { content: TRELLO_BOARD },
      ),
    ).rejects.toThrow(DomainError);
  });
});

describe("ImportService.apply", () => {
  it("turns lists into columns, labels into tags, and checklists into subtasks", async () => {
    const result = await imports.apply(seeded.context, workspaceId(), "trello", {
      content: TRELLO_BOARD,
    });

    expect(result.dryRun).toBe(false);
    expect(result.projectId).not.toBeNull();

    const detail = await projects.get(seeded.context, workspaceId(), result.projectId!);
    expect(detail.project.name).toBe("Website Relaunch");
    expect(detail.statuses.map((status) => status.name)).toEqual([
      "Backlog",
      "This week",
      "Doing",
      "Waiting on client",
      "Done",
    ]);
    // New work needs a home that is not Done (spec 11.4).
    expect(detail.statuses.find((status) => status.isDefault)?.name).toBe("Backlog");

    const listed = await tasks.list(seeded.context, {
      workspaceId: workspaceId(),
      projectId: result.projectId!,
      limit: 50,
      includeSubtasks: true,
      sort: "rank",
      order: "asc",
    });
    const byTitle = new Map(listed.data.map((task) => [task.title, task]));

    const interview = byTitle.get("Interview five customers");
    expect(interview?.tags.map((tag) => tag.name)).toEqual(["research"]);
    expect(interview?.dueDate).toBe("2026-09-14");
    expect(interview?.deferUntil).toBe("2026-09-07");
    expect(interview?.subtaskProgress).toEqual({ completed: 1, total: 3 });
    expect(byTitle.get("Write the screener")?.parentTaskId).toBe(interview?.id);
    expect(byTitle.get("Write the screener")?.isCompleted).toBe(true);

    // A card in a Done list, or one Trello marked dueComplete, arrives completed.
    expect(byTitle.get("Sign off the sitemap")?.isCompleted).toBe(true);
    // An archived card keeps its notes in the Trash rather than being dropped.
    expect(byTitle.has("Old vendor spike")).toBe(false);

    // An open checklist item sits in its card's column rather than scattering across
    // the workflow; a ticked one goes to Done, exactly as completing it by hand would.
    expect(byTitle.get("Send the invitations")?.statusId).toBe(interview?.statusId);
    expect(byTitle.get("Write the screener")?.statusId).not.toBe(interview?.statusId);

    const trashed = await tasks.list(seeded.context, {
      workspaceId: workspaceId(),
      deleted: true,
      limit: 50,
      includeSubtasks: true,
      sort: "rank",
      order: "asc",
    });
    expect(trashed.data.map((task) => task.title)).toEqual(["Old vendor spike"]);
  });

  it("records the import on the workspace and the source on every task", async () => {
    const result = await imports.apply(seeded.context, workspaceId(), "trello", {
      content: TRELLO_BOARD,
    });

    const imported = unitOfWork.data.activity.find(
      (event) => event.eventType === WORKSPACE_EVENTS.imported,
    );
    expect(imported?.aggregateId).toBe(workspaceId());
    expect(imported?.payload).toMatchObject({
      source: "trello",
      projectId: result.projectId,
      projectName: "Website Relaunch",
    });
    expect(imported?.summary).toBe(
      "Imported 5 tasks from Trello into Website Relaunch",
    );

    const created = unitOfWork.data.activity.filter(
      (event) => event.eventType === TASK_EVENTS.created,
    );
    expect(created).toHaveLength(8);
    for (const event of created) {
      expect(event.payload).toHaveProperty("importedFrom");
      expect((event.payload.importedFrom as { source: string }).source).toBe("trello");
    }

    // Every activity row has its outbox twin (EVT-001).
    expect(unitOfWork.data.outbox).toHaveLength(unitOfWork.data.activity.length);
  });

  it("rolls the whole import back when the commit fails", async () => {
    unitOfWork.failNextCommit();

    await expect(
      imports.apply(seeded.context, workspaceId(), "trello", { content: TRELLO_BOARD }),
    ).rejects.toThrow(/simulated commit failure/);

    // The project, its columns, its tags, every task, and every event row go together.
    expect(unitOfWork.data.tasks.size).toBe(0);
    expect(unitOfWork.data.projects.size).toBe(1);
    expect(unitOfWork.data.statuses.size).toBe(seeded.statuses.length);
    expect(unitOfWork.data.tags.size).toBe(0);
    expect(unitOfWork.data.activity).toHaveLength(0);
    expect(unitOfWork.data.outbox).toHaveLength(0);
  });

  it("refuses to import over a project that already exists", async () => {
    await imports.apply(seeded.context, workspaceId(), "trello", {
      content: TRELLO_BOARD,
    });

    await expect(
      imports.apply(seeded.context, workspaceId(), "trello", { content: TRELLO_BOARD }),
    ).rejects.toThrow(/already exists/);
  });

  it("honours a dry run passed to apply, so a mis-set flag cannot write", async () => {
    const result = await imports.apply(seeded.context, workspaceId(), "trello", {
      content: TRELLO_BOARD,
      dryRun: true,
    });

    expect(result.projectId).toBeNull();
    expect(unitOfWork.data.tasks.size).toBe(0);
  });

  it("imports a CSV with its own columns, nesting rows under their parent", async () => {
    const csv = [
      "key,title,description,status,priority,dueDate,tags,parentKey,completed",
      'ML-000001,"Draft the brief","## Notes",Ready,high,2026-09-15,"research, ux",,',
      "ML-000002,Collect examples,,Ready,,,,ML-000001,yes",
      "ML-000003,Ship it,,Done,,,,,",
    ].join("\n");

    const result = await imports.apply(seeded.context, workspaceId(), "csv", {
      content: csv,
      projectName: "Brief",
    });

    const listed = await tasks.list(seeded.context, {
      workspaceId: workspaceId(),
      projectId: result.projectId!,
      limit: 50,
      includeSubtasks: true,
      sort: "rank",
      order: "asc",
    });
    const byTitle = new Map(listed.data.map((task) => [task.title, task]));

    expect(result.preview.projectName).toBe("Brief");
    expect(byTitle.get("Draft the brief")?.priority).toBe("high");
    expect(byTitle.get("Draft the brief")?.tags.map((tag) => tag.name)).toEqual([
      "research",
      "ux",
    ]);
    expect(byTitle.get("Collect examples")?.parentTaskId).toBe(
      byTitle.get("Draft the brief")?.id,
    );
    expect(byTitle.get("Collect examples")?.isCompleted).toBe(true);
    expect(byTitle.get("Ship it")?.isCompleted).toBe(true);
  });

  it("reuses a tag that already exists rather than creating a second one", async () => {
    await imports.apply(seeded.context, workspaceId(), "csv", {
      content: "title,tags\nFirst,Research",
      projectName: "One",
    });
    await imports.apply(seeded.context, workspaceId(), "csv", {
      content: "title,tags\nSecond,research",
      projectName: "Two",
    });

    expect([...unitOfWork.data.tags.values()].map((tag) => tag.name)).toEqual([
      "Research",
    ]);
  });
});
