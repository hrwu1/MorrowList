import {
  CAPTURE_EXAMPLES,
  CAPTURE_EXAMPLE_PROJECTS,
  CAPTURE_EXAMPLE_TAGS,
  CAPTURE_EXAMPLE_TODAY,
  describeRecurrence,
  type CaptureExample,
} from "@morrowlist/domain";
import { describe, expect, it } from "vitest";

import {
  capture,
  captureFields,
  captureReport,
  needsWorkspaceNames,
  projectIdFor,
  type CaptureContext,
} from "./capture.js";

/**
 * `morrow task add` and quick add share `parseCapture`, and this suite is one half of the
 * proof: it replays `CAPTURE_EXAMPLES` through the CLI's own request builder. The web
 * suite (`apps/web/features/tasks/lib/capture.test.ts`) replays the same rows through
 * its own, and both assert the same expected request.
 */

const CONTEXT: CaptureContext = {
  projects: CAPTURE_EXAMPLE_PROJECTS.map((name, index) => ({
    id: `project-${index}`,
    name,
  })),
  tags: CAPTURE_EXAMPLE_TAGS,
  createTags: false,
  today: CAPTURE_EXAMPLE_TODAY,
};

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

describe("capture", () => {
  it.each(CAPTURE_EXAMPLES.map((example) => [example.text, example] as const))(
    "%s",
    (text, example) => {
      const parsed = capture(text, CONTEXT);
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

  it("resolves a project name back to the id it came from", () => {
    const parsed = capture("Write copy #launch", CONTEXT);
    expect(projectIdFor(CONTEXT, parsed.projectName)).toBe("project-0");
    expect(projectIdFor(CONTEXT, null)).toBeNull();
    expect(projectIdFor(CONTEXT, "Nothing")).toBeNull();
  });

  it("only asks the workspace for names when the text carries a marker", () => {
    expect(needsWorkspaceNames("Call Sam tomorrow 5pm p1")).toBe(false);
    expect(needsWorkspaceNames("Call Sam #Launch")).toBe(true);
    expect(needsWorkspaceNames("Call Sam @phone")).toBe(true);
    expect(needsWorkspaceNames('Call Sam tag:"deep work"')).toBe(true);
    expect(needsWorkspaceNames("Email sam@example.com")).toBe(false);
  });

  it("turns an unknown tag into one to create when --create-tags is given", () => {
    const without = capture("Call mum @mobile", CONTEXT);
    expect(without.tagNames).toEqual([]);
    expect(without.title).toBe("Call mum @mobile");

    const with_ = capture("Call mum @mobile", { ...CONTEXT, createTags: true });
    expect(with_.tagNames).toEqual(["mobile"]);
    expect(with_.title).toBe("Call mum");
  });

  it("leaves an unknown project alone even with --create-tags", () => {
    const parsed = capture("Write copy #marketing", { ...CONTEXT, createTags: true });
    expect(parsed.title).toBe("Write copy #marketing");
    expect(parsed.unknownProjects).toEqual(["marketing"]);
  });

  it("reports what it read for --json", () => {
    const report = captureReport(capture("Call Sam tomorrow 5pm p1 #Launch", CONTEXT));
    expect(report).toEqual({
      title: "Call Sam",
      priority: "urgent",
      dueDate: "2026-09-06",
      dueTime: "17:00",
      projectName: "Launch",
      spans: [
        {
          kind: "dueDate",
          text: "tomorrow 5pm",
          label: "Planned 2026-09-06 at 17:00",
          known: true,
        },
        { kind: "priority", text: "p1", label: "Urgent", known: true },
        { kind: "project", text: "#Launch", label: "Project Launch", known: true },
      ],
    });
  });

  it("falls back to the host's calendar date when none is given", () => {
    const parsed = capture("Standup today", { ...CONTEXT, today: undefined });
    expect(parsed.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.title).toBe("Standup");
  });
});
