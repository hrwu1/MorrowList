import { tagColorTokenSchema } from "@morrowlist/contracts";
import { TAG_COLOR_TOKENS, fixedClock } from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { TagService } from "./service.js";

const NOW = new Date("2026-09-03T09:00:00.000Z");

let unitOfWork: InMemoryUnitOfWork;
let tags: TagService;
let tasks: TaskService;
let seeded: SeededWorkspace;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  tags = new TagService({ unitOfWork, clock: fixedClock(NOW) });
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "test-cursor-secret",
  });
});

describe("TagService.create", () => {
  it("creates a tag with a normalized name, default colour, and both event rows", async () => {
    const tag = await tags.create(seeded.context, seeded.workspace.id, {
      name: "  Deep   Work ",
    });

    expect(tag).toMatchObject({
      name: "Deep Work",
      colorToken: "neutral",
      description: null,
    });
    expect(unitOfWork.data.activity.map((event) => event.eventType)).toEqual([
      "tag.created",
    ]);
    expect(unitOfWork.data.outbox[0]).toMatchObject({
      eventType: "tag.created",
      aggregateType: "tag",
      aggregateId: tag.id,
      payload: { tagId: tag.id, tagName: "Deep Work" },
    });
  });

  it("rejects a name that differs only by case with a clear conflict", async () => {
    // Completion criterion: "Deep Work" then "deep work" is a conflict.
    await tags.create(seeded.context, seeded.workspace.id, { name: "Deep Work" });

    await expect(
      tags.create(seeded.context, seeded.workspace.id, { name: "deep work" }),
    ).rejects.toMatchObject({
      code: "TAG_NAME_CONFLICT",
      message: expect.stringContaining('"Deep Work" already exists'),
    });
    expect(unitOfWork.data.tags.size).toBe(1);
  });

  it("allows the same name in another workspace", async () => {
    const other = seedWorkspace(unitOfWork.data);
    await tags.create(seeded.context, seeded.workspace.id, { name: "Focus" });

    await expect(
      tags.create(other.context, other.workspace.id, { name: "focus" }),
    ).resolves.toMatchObject({ name: "focus" });
  });

  it("rejects an unknown colour token", async () => {
    await expect(
      tags.create(seeded.context, seeded.workspace.id, {
        name: "Bad",
        colorToken: "magenta" as never,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("rolls back the tag and both event rows when the commit fails", async () => {
    unitOfWork.failNextCommit();

    await expect(
      tags.create(seeded.context, seeded.workspace.id, { name: "Doomed" }),
    ).rejects.toThrow(/simulated commit failure/);

    expect(unitOfWork.data.tags.size).toBe(0);
    expect(unitOfWork.data.activity).toHaveLength(0);
    expect(unitOfWork.data.outbox).toHaveLength(0);
  });

  it("keeps the palette in step between the domain and the contracts", () => {
    // Contracts is a leaf package and cannot import the domain list; this guards the copy.
    expect(tagColorTokenSchema.options).toEqual([...TAG_COLOR_TOKENS]);
  });
});

describe("TagService.list", () => {
  it("orders tags case-insensitively by name and counts live tasks", async () => {
    const zebra = await tags.create(seeded.context, seeded.workspace.id, {
      name: "zebra",
    });
    const apple = await tags.create(seeded.context, seeded.workspace.id, {
      name: "Apple",
    });
    const task = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Tagged",
    });
    const deleted = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Trashed",
    });
    await tasks.addTag(seeded.context, seeded.workspace.id, task.id, zebra.id);
    await tasks.addTag(seeded.context, seeded.workspace.id, deleted.id, zebra.id);
    await tasks.delete(seeded.context, seeded.workspace.id, deleted.id);

    const listed = await tags.list(seeded.context, seeded.workspace.id);

    expect(listed.data.map((tag) => [tag.name, tag.taskCount])).toEqual([
      [apple.name, 0],
      [zebra.name, 1],
    ]);
  });
});

describe("TagService.update", () => {
  it("renames, recolours, and records the changes", async () => {
    const created = await tags.create(seeded.context, seeded.workspace.id, {
      name: "Focus",
    });

    const updated = await tags.update(seeded.context, seeded.workspace.id, created.id, {
      name: "Deep Focus",
      colorToken: "teal",
      description: "Uninterrupted blocks",
    });

    expect(updated).toMatchObject({
      name: "Deep Focus",
      colorToken: "teal",
      description: "Uninterrupted blocks",
    });
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: "tag.updated",
      payload: {
        tagId: created.id,
        changes: { name: { from: "Focus", to: "Deep Focus" } },
      },
    });
  });

  it("allows changing only the casing of a name", async () => {
    const created = await tags.create(seeded.context, seeded.workspace.id, {
      name: "focus",
    });

    await expect(
      tags.update(seeded.context, seeded.workspace.id, created.id, { name: "Focus" }),
    ).resolves.toMatchObject({ name: "Focus" });
  });

  it("rejects renaming onto another tag's name", async () => {
    await tags.create(seeded.context, seeded.workspace.id, { name: "Focus" });
    const other = await tags.create(seeded.context, seeded.workspace.id, {
      name: "Errands",
    });

    await expect(
      tags.update(seeded.context, seeded.workspace.id, other.id, { name: "FOCUS" }),
    ).rejects.toMatchObject({ code: "TAG_NAME_CONFLICT" });
  });

  it("records no event when nothing changed", async () => {
    const created = await tags.create(seeded.context, seeded.workspace.id, {
      name: "Focus",
    });

    await tags.update(seeded.context, seeded.workspace.id, created.id, {
      name: "Focus",
    });

    expect(unitOfWork.data.activity).toHaveLength(1);
  });

  it("reports an unknown tag as not found", async () => {
    await expect(
      tags.update(seeded.context, seeded.workspace.id, "missing", { name: "x" }),
    ).rejects.toMatchObject({ code: "TAG_NOT_FOUND" });
  });
});

describe("TagService.delete", () => {
  it("removes the tag and its associations but keeps the tasks", async () => {
    const tag = await tags.create(seeded.context, seeded.workspace.id, {
      name: "Focus",
    });
    const task = await tasks.create(seeded.context, {
      workspaceId: seeded.workspace.id,
      title: "Keeps living",
    });
    await tasks.addTag(seeded.context, seeded.workspace.id, task.id, tag.id);

    await tags.delete(seeded.context, seeded.workspace.id, tag.id);

    expect(unitOfWork.data.tags.size).toBe(0);
    expect(unitOfWork.data.taskTags).toHaveLength(0);
    const survivor = await tasks.get(seeded.context, seeded.workspace.id, task.id);
    expect(survivor.tags).toEqual([]);
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: "tag.deleted",
      payload: { tagId: tag.id, tagName: "Focus", taskCount: 1 },
    });
  });

  it("does not delete a tag through another workspace", async () => {
    const other = seedWorkspace(unitOfWork.data);
    const tag = await tags.create(other.context, other.workspace.id, {
      name: "Theirs",
    });

    await expect(
      tags.delete(seeded.context, seeded.workspace.id, tag.id),
    ).rejects.toMatchObject({ code: "TAG_NOT_FOUND" });
    expect(unitOfWork.data.tags.size).toBe(1);
  });
});
