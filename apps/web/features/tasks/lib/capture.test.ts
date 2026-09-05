import {
  CAPTURE_EXAMPLES,
  CAPTURE_EXAMPLE_PROJECTS,
  CAPTURE_EXAMPLE_TAGS,
  CAPTURE_EXAMPLE_TODAY,
  describeRecurrence,
  type CaptureExample,
} from "@morrowlist/domain";
import { describe, expect, it } from "vitest";

import { capturePlan, capturePreview, captureFields, parseQuickAdd } from "./capture";

/**
 * Quick add and `morrow task add` share `parseCapture`, and this suite is one half of the
 * proof: it replays `CAPTURE_EXAMPLES` through the web's own request builder. The CLI
 * suite (`apps/cli/src/commands/capture.test.ts`) replays the same rows through its own,
 * and both assert the same expected request.
 */

const PROJECTS = CAPTURE_EXAMPLE_PROJECTS.map((name, index) => ({
  id: `project-${index}`,
  name,
}));
const TAGS = CAPTURE_EXAMPLE_TAGS.map((name, index) => ({ id: `tag-${index}`, name }));

function parse(text: string) {
  return parseQuickAdd(text, CAPTURE_EXAMPLE_TODAY, PROJECTS, TAGS);
}

/** The create-task body an example stands for, built from the example alone. */
function expectedBody(example: CaptureExample) {
  return {
    title: example.title,
    ...(example.priority ? { priority: example.priority } : {}),
    ...(example.dueDate ? { dueDate: example.dueDate } : {}),
    ...(example.dueTime ? { dueTime: example.dueTime } : {}),
    ...(example.deferUntil ? { deferUntil: example.deferUntil } : {}),
    ...(example.deadline ? { deadline: example.deadline } : {}),
    ...(example.deadlineTime ? { deadlineTime: example.deadlineTime } : {}),
    ...(example.recurrence ? { recurrence: example.recurrence } : {}),
    ...(example.projectName ? { projectName: example.projectName } : {}),
    ...(example.tagNames?.length ? { tagNames: example.tagNames } : {}),
  };
}

describe("quick add capture", () => {
  it.each(CAPTURE_EXAMPLES.map((example) => [example.text, example] as const))(
    "%s",
    (text, example) => {
      const parsed = parse(text);
      const { recurrence, ...fields } = captureFields(parsed);
      expect({
        title: parsed.title,
        ...fields,
        ...(recurrence ? { recurrence: describeRecurrence(recurrence) } : {}),
        ...(parsed.projectName ? { projectName: parsed.projectName } : {}),
        ...(parsed.tagNames.length ? { tagNames: [...parsed.tagNames] } : {}),
      }).toEqual(expectedBody(example));
    },
  );
});

describe("capturePlan", () => {
  it("builds the request the Inbox quick add sends", () => {
    const plan = capturePlan(
      parse("Call Sam tomorrow 5pm p1 #Launch @phone"),
      PROJECTS,
      TAGS,
      {},
    );
    expect(plan.request).toEqual({
      title: "Call Sam",
      priority: "urgent",
      dueDate: "2026-09-06",
      dueTime: "17:00",
      projectId: "project-0",
    });
    expect(plan.tagIds).toEqual(["tag-0"]);
  });

  it("keeps the pane's project and column when the text names neither", () => {
    const plan = capturePlan(parse("Call Sam tomorrow"), PROJECTS, TAGS, {
      projectId: "project-2",
      statusId: "status-9",
    });
    expect(plan.request).toEqual({
      title: "Call Sam",
      dueDate: "2026-09-06",
      projectId: "project-2",
      statusId: "status-9",
    });
  });

  it("lets a typed project override the pane, dropping a column it cannot belong to", () => {
    const plan = capturePlan(parse("Call Sam #Launch"), PROJECTS, TAGS, {
      projectId: "project-2",
      statusId: "status-9",
    });
    expect(plan.request).toEqual({ title: "Call Sam", projectId: "project-0" });
  });

  it("keeps the column when the typed project is the pane's own", () => {
    const plan = capturePlan(parse("Call Sam #Home"), PROJECTS, TAGS, {
      projectId: "project-2",
      statusId: "status-9",
    });
    expect(plan.request).toEqual({
      title: "Call Sam",
      projectId: "project-2",
      statusId: "status-9",
    });
  });

  it("drops a tag whose id it cannot find rather than sending a broken request", () => {
    const plan = capturePlan(parse("Call Sam @phone"), PROJECTS, [], {});
    expect(plan.tagIds).toEqual([]);
  });
});

describe("capturePreview", () => {
  it("reads as the sentence the task will become", () => {
    expect(capturePreview(parse("Call Sam tomorrow 5pm p1 #Launch @phone"))).toBe(
      "Call Sam · Planned 2026-09-06 at 17:00 · Urgent · Project Launch · Tag phone",
    );
  });

  it("leaves an unknown project out of the sentence but keeps it in the title", () => {
    expect(capturePreview(parse("Write copy #marketing tomorrow"))).toBe(
      "Write copy #marketing · Planned 2026-09-06",
    );
  });

  it("says the whole line when nothing was read", () => {
    expect(capturePreview(parse("Buy milk"))).toBe("Buy milk");
  });
});
