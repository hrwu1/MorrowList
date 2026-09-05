import { describe, expect, it } from "vitest";

import {
  ImportFormatError,
  defaultPlannedStatus,
  guessStatusCategory,
} from "./plan.js";
import { planFromTrelloBoard, planFromTrelloJson } from "./trello.js";

/** A board exercising every mapping rule, shaped like Trello's own JSON export. */
function board(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1",
    name: "Product Roadmap",
    closed: false,
    lists: [
      { id: "l3", name: "Done", closed: false, pos: 49152 },
      { id: "l1", name: "Backlog", closed: false, pos: 16384 },
      { id: "l2", name: "Doing", closed: false, pos: 32768 },
    ],
    labels: [
      { id: "lb1", name: "research", color: "green" },
      { id: "lb2", name: "ux", color: "purple" },
      { id: "lb3", name: "", color: "black" },
    ],
    cards: [
      {
        id: "c1",
        name: "Interview five users",
        desc: "Recruit from the waitlist.",
        closed: false,
        idList: "l1",
        idLabels: ["lb1", "lb3"],
        due: "2026-09-14T12:00:00.000Z",
        start: "2026-09-01T00:00:00.000Z",
        dueComplete: false,
        pos: 16384,
      },
      {
        id: "c2",
        name: "Ship the pricing page",
        desc: "",
        closed: false,
        idList: "l3",
        labels: [{ id: "lb2", name: "ux", color: "purple" }],
        due: null,
        dueComplete: false,
        pos: 32768,
      },
      {
        id: "c3",
        name: "Old spike",
        desc: "",
        closed: true,
        idList: "l2",
        idLabels: [],
        due: null,
        dueComplete: true,
        pos: 49152,
      },
      { id: "c4", name: "   ", desc: "", closed: false, idList: "l1" },
    ],
    checklists: [
      {
        id: "ch2",
        idCard: "c1",
        name: "Follow up",
        pos: 2,
        checkItems: [{ id: "ci3", name: "Send thanks", state: "incomplete", pos: 1 }],
      },
      {
        id: "ch1",
        idCard: "c1",
        name: "Recruiting",
        pos: 1,
        checkItems: [
          { id: "ci2", name: "Book rooms", state: "incomplete", pos: 2 },
          { id: "ci1", name: "Write the screener", state: "complete", pos: 1 },
        ],
      },
    ],
    ...overrides,
  };
}

describe("planFromTrelloBoard", () => {
  it("maps lists to columns in board order and guesses their categories", () => {
    const plan = planFromTrelloBoard(board());

    expect(plan.projectName).toBe("Product Roadmap");
    expect(plan.statuses.map((status) => [status.name, status.category])).toEqual([
      ["Backlog", "backlog"],
      ["Doing", "in_progress"],
      ["Done", "done"],
    ]);
    expect(defaultPlannedStatus(plan.statuses)?.name).toBe("Backlog");
  });

  it("maps cards to tasks with labels as tags and dates from the due instant", () => {
    const plan = planFromTrelloBoard(board());
    const [first] = plan.tasks;

    expect(first?.title).toBe("Interview five users");
    expect(first?.descriptionMd).toBe("Recruit from the waitlist.");
    expect(first?.statusExternalId).toBe("l1");
    expect(first?.dueDate).toBe("2026-09-14");
    expect(first?.deferUntil).toBe("2026-09-01");
    // The unnamed board label is not a tag; a colour alone says nothing.
    expect(first?.tags).toEqual(["research"]);
    expect(first?.externalId).toBe("c1");
  });

  it("flattens checklists into subtasks in checklist then item order", () => {
    const plan = planFromTrelloBoard(board());

    expect(plan.tasks[0]?.subtasks).toEqual([
      { title: "Write the screener", isCompleted: true, externalId: "ci1" },
      { title: "Book rooms", isCompleted: false, externalId: "ci2" },
      { title: "Send thanks", isCompleted: false, externalId: "ci3" },
    ]);
  });

  it("completes a card in a Done list or marked dueComplete, and trashes an archived one", () => {
    const plan = planFromTrelloBoard(board());
    const byTitle = new Map(plan.tasks.map((task) => [task.title, task]));

    expect(byTitle.get("Ship the pricing page")?.isCompleted).toBe(true);
    expect(byTitle.get("Ship the pricing page")?.isArchived).toBe(false);
    expect(byTitle.get("Old spike")?.isCompleted).toBe(true);
    expect(byTitle.get("Old spike")?.isArchived).toBe(true);
  });

  it("reports a nameless card as an issue rather than importing a blank task", () => {
    const plan = planFromTrelloBoard(board());

    expect(plan.tasks).toHaveLength(3);
    expect(plan.issues).toEqual([
      { row: 4, title: null, reason: "The card has no name." },
    ]);
  });

  it("names what it does not read, so nothing is dropped silently", () => {
    const plan = planFromTrelloBoard(board());

    expect(plan.ignoredFields).toContain("comments");
    expect(plan.ignoredFields).toContain("members and card assignments");
  });

  it("gives a board with no Done list one, so a task can be completed", () => {
    const plan = planFromTrelloBoard(
      board({ lists: [{ id: "l1", name: "Ideas", closed: false, pos: 1 }] }),
    );

    expect(plan.statuses.map((status) => status.category)).toEqual(["backlog", "done"]);
  });

  it("gives a board that is all Done lists somewhere for new work to start", () => {
    const plan = planFromTrelloBoard(
      board({ lists: [{ id: "l3", name: "Done", closed: false, pos: 1 }], cards: [] }),
    );

    expect(plan.statuses.map((status) => status.category)).toEqual(["backlog", "done"]);
  });

  it("takes a project name override", () => {
    expect(planFromTrelloBoard(board(), { projectName: "Q4 plan" }).projectName).toBe(
      "Q4 plan",
    );
  });

  it("refuses a document that is not a Trello board", () => {
    expect(() => planFromTrelloJson("{ not json")).toThrow(ImportFormatError);
    expect(() => planFromTrelloJson('{"name":"x"}')).toThrow(
      /does not look like a Trello board/,
    );
    expect(() => planFromTrelloBoard([])).toThrow(ImportFormatError);
  });

  it("parses the same plan from JSON text as from the parsed object", () => {
    expect(planFromTrelloJson(JSON.stringify(board()))).toEqual(
      planFromTrelloBoard(board()),
    );
  });
});

describe("guessStatusCategory", () => {
  it("reads a board's own vocabulary, and falls back to backlog", () => {
    expect(guessStatusCategory("Doing")).toBe("in_progress");
    expect(guessStatusCategory("QA / review")).toBe("review");
    expect(guessStatusCategory("Waiting on legal")).toBe("blocked");
    expect(guessStatusCategory("Up next")).toBe("ready");
    expect(guessStatusCategory("Shipped")).toBe("done");
    expect(guessStatusCategory("Zebras")).toBe("backlog");
  });
});
