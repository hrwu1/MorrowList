import {
  MAX_FIELDS_PER_WORKSPACE as CONTRACT_FIELD_LIMIT,
  fieldFilterOperatorSchema,
  fieldTypeSchema,
} from "@morrowlist/contracts";
import {
  FIELD_FILTER_OPERATORS,
  FIELD_TYPES,
  MAX_FIELDS_PER_WORKSPACE,
  fixedClock,
} from "@morrowlist/domain";
import { beforeEach, describe, expect, it } from "vitest";

import { TaskService } from "../tasks/service.js";
import {
  createInMemoryUnitOfWork,
  emptyData,
  seedWorkspace,
  type InMemoryUnitOfWork,
  type SeededWorkspace,
} from "../testing/index.js";

import { FieldService } from "./service.js";

const NOW = new Date("2026-09-05T09:00:00.000Z");

let unitOfWork: InMemoryUnitOfWork;
let fields: FieldService;
let tasks: TaskService;
let seeded: SeededWorkspace;

beforeEach(() => {
  unitOfWork = createInMemoryUnitOfWork(emptyData());
  seeded = seedWorkspace(unitOfWork.data);
  fields = new FieldService({ unitOfWork, clock: fixedClock(NOW) });
  tasks = new TaskService({
    unitOfWork,
    clock: fixedClock(NOW),
    cursorSecret: "test-cursor-secret",
  });
});

const workspaceId = () => seeded.workspace.id;

describe("FieldService.create", () => {
  it("derives the key from the name and records both event rows", async () => {
    const field = await fields.create(seeded.context, workspaceId(), {
      name: "  Story   Points ",
      type: "number",
    });

    expect(field).toMatchObject({
      key: "story_points",
      name: "Story Points",
      type: "number",
      options: [],
      showOnCard: false,
    });
    expect(unitOfWork.data.activity.map((event) => event.eventType)).toEqual([
      "field.created",
    ]);
    expect(unitOfWork.data.outbox[0]).toMatchObject({
      eventType: "field.created",
      aggregateType: "field",
      aggregateId: field.id,
      payload: { fieldId: field.id, key: "story_points", type: "number" },
    });
  });

  it("refuses a duplicate key and a select with no options", async () => {
    await fields.create(seeded.context, workspaceId(), {
      name: "Effort",
      type: "number",
    });

    await expect(
      fields.create(seeded.context, workspaceId(), { name: "effort", type: "text" }),
    ).rejects.toMatchObject({ code: "FIELD_KEY_CONFLICT" });
    await expect(
      fields.create(seeded.context, workspaceId(), { name: "Stage", type: "select" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  /** The completion criterion: the eleventh field is rejected with a clear error. */
  it("refuses the eleventh field", async () => {
    for (let index = 0; index < MAX_FIELDS_PER_WORKSPACE; index += 1) {
      await fields.create(seeded.context, workspaceId(), {
        name: `Field ${index}`,
        type: "text",
      });
    }

    await expect(
      fields.create(seeded.context, workspaceId(), {
        name: "One too many",
        type: "text",
      }),
    ).rejects.toMatchObject({
      code: "FIELD_LIMIT_REACHED",
      message: expect.stringContaining("at most 10 custom fields"),
    });
    expect((await fields.list(seeded.context, workspaceId())).data).toHaveLength(
      MAX_FIELDS_PER_WORKSPACE,
    );
  });

  it("counts the cap per workspace", async () => {
    const other = seedWorkspace(unitOfWork.data);
    for (let index = 0; index < MAX_FIELDS_PER_WORKSPACE; index += 1) {
      await fields.create(seeded.context, workspaceId(), {
        name: `Field ${index}`,
        type: "text",
      });
    }

    await expect(
      fields.create(other.context, other.workspace.id, { name: "Fine", type: "text" }),
    ).resolves.toMatchObject({ key: "fine" });
  });

  it("rolls back the definition and both event rows when the commit fails", async () => {
    unitOfWork.failNextCommit();

    await expect(
      fields.create(seeded.context, workspaceId(), { name: "Doomed", type: "text" }),
    ).rejects.toThrow(/simulated commit failure/);

    expect(unitOfWork.data.fields.size).toBe(0);
    expect(unitOfWork.data.activity).toHaveLength(0);
    expect(unitOfWork.data.outbox).toHaveLength(0);
  });

  it("keeps the type and operator lists in step between the domain and contracts", () => {
    // Contracts is a leaf package and cannot import the domain lists; this guards the copies.
    expect(fieldTypeSchema.options).toEqual([...FIELD_TYPES]);
    expect(fieldFilterOperatorSchema.options).toEqual([...FIELD_FILTER_OPERATORS]);
    expect(CONTRACT_FIELD_LIMIT).toBe(MAX_FIELDS_PER_WORKSPACE);
  });
});

describe("FieldService.list and update", () => {
  it("lists in creation order with the number of tasks carrying a value", async () => {
    const effort = await fields.create(seeded.context, workspaceId(), {
      name: "Effort",
      type: "number",
    });
    await fields.create(seeded.context, workspaceId(), { name: "Notes", type: "text" });
    await tasks.create(seeded.context, {
      workspaceId: workspaceId(),
      title: "Sized",
      fields: { [effort.key]: 3 },
    });
    await tasks.create(seeded.context, {
      workspaceId: workspaceId(),
      title: "Unsized",
    });

    const listed = await fields.list(seeded.context, workspaceId());
    expect(listed.data.map((each) => [each.key, each.taskCount])).toEqual([
      ["effort", 1],
      ["notes", 0],
    ]);
  });

  it("renames and reflags without touching the key or the type", async () => {
    const stage = await fields.create(seeded.context, workspaceId(), {
      name: "Stage",
      type: "select",
      options: ["alpha", "beta"],
    });

    const updated = await fields.update(seeded.context, workspaceId(), stage.id, {
      name: "Release stage",
      showOnCard: true,
      options: ["alpha", "beta", "ga"],
    });

    expect(updated).toMatchObject({
      key: "stage",
      type: "select",
      name: "Release stage",
      showOnCard: true,
      options: ["alpha", "beta", "ga"],
    });
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: "field.updated",
      payload: { changes: { name: { from: "Stage", to: "Release stage" } } },
    });
  });

  it("records nothing when nothing changed", async () => {
    const field = await fields.create(seeded.context, workspaceId(), {
      name: "Notes",
      type: "text",
    });
    const before = unitOfWork.data.activity.length;

    await fields.update(seeded.context, workspaceId(), field.id, { name: "Notes" });
    expect(unitOfWork.data.activity).toHaveLength(before);
  });
});

describe("FieldService.delete", () => {
  it("clears the key from every task and reports the affected count", async () => {
    const effort = await fields.create(seeded.context, workspaceId(), {
      name: "Effort",
      type: "number",
    });
    const notes = await fields.create(seeded.context, workspaceId(), {
      name: "Notes",
      type: "text",
    });
    const first = await tasks.create(seeded.context, {
      workspaceId: workspaceId(),
      title: "One",
      fields: { effort: 3, notes: "keep me" },
    });
    const second = await tasks.create(seeded.context, {
      workspaceId: workspaceId(),
      title: "Two",
      fields: { effort: 5 },
    });
    await tasks.create(seeded.context, { workspaceId: workspaceId(), title: "Three" });

    await fields.delete(seeded.context, workspaceId(), effort.id);

    expect(unitOfWork.data.tasks.get(first.id)?.fields).toEqual({ notes: "keep me" });
    expect(unitOfWork.data.tasks.get(second.id)?.fields).toEqual({});
    expect(unitOfWork.data.activity.at(-1)).toMatchObject({
      eventType: "field.deleted",
      summary: "Deleted field Effort",
      payload: { key: "effort", taskCount: 2 },
    });
    expect(notes.id).toBeDefined();
  });

  it("rolls back the definition, the cleared values and both event rows together", async () => {
    const effort = await fields.create(seeded.context, workspaceId(), {
      name: "Effort",
      type: "number",
    });
    const task = await tasks.create(seeded.context, {
      workspaceId: workspaceId(),
      title: "Sized",
      fields: { effort: 3 },
    });
    const activityBefore = unitOfWork.data.activity.length;
    const outboxBefore = unitOfWork.data.outbox.length;
    unitOfWork.failNextCommit();

    await expect(
      fields.delete(seeded.context, workspaceId(), effort.id),
    ).rejects.toThrow(/simulated commit failure/);

    expect(unitOfWork.data.fields.has(effort.id)).toBe(true);
    expect(unitOfWork.data.tasks.get(task.id)?.fields).toEqual({ effort: 3 });
    expect(unitOfWork.data.activity).toHaveLength(activityBefore);
    expect(unitOfWork.data.outbox).toHaveLength(outboxBefore);
  });

  it("refuses a field from another workspace", async () => {
    const other = seedWorkspace(unitOfWork.data);
    const field = await fields.create(other.context, other.workspace.id, {
      name: "Theirs",
      type: "text",
    });

    await expect(
      fields.delete(seeded.context, workspaceId(), field.id),
    ).rejects.toMatchObject({ code: "FIELD_NOT_FOUND" });
  });
});
