import { describe, expect, it } from "vitest";

import { planFromCsv } from "./csv.js";
import { ImportFormatError } from "./plan.js";

const HEADER = "key,title,description,status,priority,dueDate,tags,parentKey,completed";

describe("planFromCsv", () => {
  it("maps the columns the task export writes", () => {
    const plan = planFromCsv(
      [
        HEADER,
        'ML-000001,"Draft the brief","## Notes",Ready,high,2026-09-15,"research, ux",,',
      ].join("\n"),
    );

    expect(plan.tasks).toEqual([
      {
        title: "Draft the brief",
        descriptionMd: "## Notes",
        priority: "high",
        dueDate: "2026-09-15",
        deadline: null,
        deferUntil: null,
        tags: ["research", "ux"],
        statusExternalId: "ready",
        isCompleted: false,
        isArchived: false,
        externalId: "ML-000001",
        subtasks: [],
      },
    ]);
    expect(plan.statuses.map((status) => [status.name, status.category])).toEqual([
      ["Ready", "ready"],
      ["Done", "done"],
    ]);
  });

  it("accepts the column names other tools use", () => {
    const plan = planFromCsv(
      "Name,Notes,List,Due Date,Labels\nWrite,ideas,Doing,2026-09-15,ops",
    );

    expect(plan.tasks[0]).toMatchObject({
      title: "Write",
      descriptionMd: "ideas",
      dueDate: "2026-09-15",
      tags: ["ops"],
      statusExternalId: "doing",
    });
  });

  it("nests a row under the parent named by key or by title", () => {
    const plan = planFromCsv(
      [
        HEADER,
        "ML-000001,Parent,,Ready,,,,,",
        "ML-000002,By key,,Ready,,,,ML-000001,yes",
        "ML-000003,By title,,Ready,,,,Parent,",
      ].join("\n"),
    );

    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]?.subtasks).toEqual([
      { title: "By key", isCompleted: true, externalId: "ML-000002" },
      { title: "By title", isCompleted: false, externalId: "ML-000003" },
    ]);
  });

  it("keeps a row whose parent is unknown, and says why", () => {
    const plan = planFromCsv([HEADER, "ML-000009,Orphan,,,,,,ML-000404,"].join("\n"));

    expect(plan.tasks.map((task) => task.title)).toEqual(["Orphan"]);
    expect(plan.issues).toEqual([
      {
        row: 2,
        title: "Orphan",
        reason: 'No row matches parent "ML-000404"; imported as a top-level task.',
      },
    ]);
  });

  it("flattens a third level rather than dropping it", () => {
    const plan = planFromCsv(
      [
        HEADER,
        "ML-000001,Parent,,,,,,,",
        "ML-000002,Child,,,,,,ML-000001,",
        "ML-000003,Grandchild,,,,,,ML-000002,",
      ].join("\n"),
    );

    expect(plan.tasks.map((task) => task.title)).toEqual(["Parent", "Grandchild"]);
    expect(plan.issues[0]?.reason).toMatch(/nest one level deep/);
  });

  it("reports a titleless row and names the columns it ignored", () => {
    const plan = planFromCsv("title,assignee,estimate\nReal,alex,3\n,bob,5");

    expect(plan.tasks.map((task) => task.title)).toEqual(["Real"]);
    expect(plan.ignoredFields).toEqual(["assignee", "estimate"]);
    expect(plan.issues).toEqual([
      { row: 3, title: null, reason: "The row has no title." },
    ]);
  });

  it("refuses a CSV with no title column and says what it found", () => {
    expect(() => planFromCsv("id,assignee\n1,alex")).toThrow(ImportFormatError);
    expect(() => planFromCsv("id,assignee\n1,alex")).toThrow(/found: id, assignee/);
    expect(() => planFromCsv("")).toThrow(/The CSV is empty/);
  });

  it("ignores an unreadable priority or date rather than failing the row", () => {
    const plan = planFromCsv("title,priority,dueDate\nWrite,SEVERE,next tuesday");

    expect(plan.tasks[0]).toMatchObject({ priority: "none", dueDate: null });
    expect(plan.issues).toEqual([]);
  });
});
