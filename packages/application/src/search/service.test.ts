import { fixedClock } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { ProjectService } from "../projects/service.js";
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

import { SearchService } from "./service.js";

const NOW = new Date("2026-09-03T09:00:00.000Z");
const SECRET = "test-cursor-secret";

let unitOfWork: InMemoryUnitOfWork;
let search: SearchService;
let tasks: TaskService;
let tags: TagService;
let projects: ProjectService;
let seeded: SeededWorkspace;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  search = new SearchService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: SECRET,
  });
  tasks = new TaskService({ unitOfWork, clock: fixedClock(NOW), cursorSecret: SECRET });
  tags = new TagService({ unitOfWork, clock: fixedClock(NOW) });
  projects = new ProjectService({ unitOfWork, clock: fixedClock(NOW) });
});

function query(q: string, extra: Record<string, unknown> = {}) {
  return search.search(seeded.context, {
    workspaceId: seeded.workspace.id,
    q,
    limit: 50,
    includeSubtasks: true,
    ...extra,
  } as never);
}

describe("SearchService.search", () => {
  it("finds a description word and reports match offsets, never markup", async () => {
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Prepare slides",
      descriptionMd: "Budget review for the <b>board</b>",
    });
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Unrelated",
    });

    const { data } = await query("budget");
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0]?.task.title).toBe("Prepare slides");
    expect(data.tasks[0]?.matches).toEqual({
      title: [],
      description: [{ start: 0, end: 6 }],
    });
  });

  it("puts the task a key names first, without duplicating it", async () => {
    const one = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "First",
    });
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Mentions ML-1 in the title",
    });

    const { data } = await query("ml-1");
    expect(data.tasks.map((hit) => hit.task.id)).toEqual([one.id, expect.any(String)]);
    expect(data.tasks[1]?.task.title).toBe("Mentions ML-1 in the title");
  });

  it("ignores a key from another workspace prefix", async () => {
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "First",
    });

    const { data } = await query("XX-1");
    expect(data.tasks).toEqual([]);
  });

  it("applies operators over explicit filters, resolving a tag by name", async () => {
    const tag = await tags.create(seeded.context, seeded.workspace.id, {
      name: "Deep Work",
    });
    const tagged = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Write",
      priority: "high",
    });
    await tasks.addTag(seeded.context, seeded.workspace.id, tagged.id, tag.id);
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Write more",
      priority: "high",
    });

    const byTag = await query('tag:"deep work"');
    expect(byTag.data.tasks.map((hit) => hit.task.id)).toEqual([tagged.id]);

    // The operator wins over the explicit filter it duplicates.
    const overridden = await query("priority:high", { priority: "low" });
    expect(overridden.data.tasks).toHaveLength(2);

    const unknownTag = await query("tag:nothing");
    expect(unknownTag.data.tasks).toEqual([]);
  });

  it("rejects an invalid operator value before touching the database", async () => {
    await expect(query("due:someday")).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { operator: "due" },
    });
  });

  it("lists matching project names for navigation, bounded and only on the first page", async () => {
    await projects.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      name: "Research launch",
    });
    for (let index = 0; index < 8; index += 1) {
      await tasks.create(seeded.context, {
        workspaceId: seeded.workspace.id,
        title: `Research note ${index}`,
      });
    }

    const first = await query("research", { limit: 5 });
    expect(first.data.projects.map((hit) => hit.project.name)).toEqual([
      "Research launch",
    ]);
    expect(first.data.projects[0]?.matches).toEqual([{ start: 0, end: 8 }]);
    expect(first.data.tasks).toHaveLength(5);
    expect(first.page.hasMore).toBe(true);

    const second = await query("research", { limit: 5, cursor: first.page.nextCursor });
    expect(second.data.projects).toEqual([]);
    expect(second.data.tasks).toHaveLength(3);
    expect(second.page).toEqual({ hasMore: false, nextCursor: null });
    const ids = [...first.data.tasks, ...second.data.tasks].map((hit) => hit.task.id);
    expect(new Set(ids).size).toBe(8);
  });

  it("rejects a forged cursor", async () => {
    await expect(query("x", { cursor: "abc.def" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("searches only the caller's workspace", async () => {
    const other = seedWorkspace(unitOfWork.data);
    await tasks.create(other.context, {
      workspaceId: other.workspace.id,
      title: "Secret",
    });

    await expect(
      search.search(seeded.context, {
        workspaceId: other.workspace.id,
        q: "secret",
        limit: 50,
        includeSubtasks: true,
      } as never),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
    const { data } = await query("secret");
    expect(data.tasks).toEqual([]);
  });

  it("carries tags and subtask progress on every hit", async () => {
    const parent = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Parent plan",
    });
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Child step",
      parentTaskId: parent.id,
    });
    const blocked = statusByCategory(seeded.statuses, "blocked");
    await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Plan stuck",
      projectId: seeded.project.id,
      statusId: blocked.id,
    });

    const { data } = await query("plan");
    const hit = data.tasks.find((candidate) => candidate.task.id === parent.id);
    expect(hit?.task.subtaskProgress).toEqual({ completed: 0, total: 1 });

    const stuck = await query("plan is:blocked");
    expect(stuck.data.tasks.map((candidate) => candidate.task.title)).toEqual([
      "Plan stuck",
    ]);
  });
});
