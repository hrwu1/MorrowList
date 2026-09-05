import { describe, expect, it } from "vitest";

import {
  CAPTURE_EXAMPLES,
  CAPTURE_EXAMPLE_PROJECTS,
  CAPTURE_EXAMPLE_TAGS,
  CAPTURE_EXAMPLE_TODAY,
  parseCapture,
  removeSpan,
  type CaptureExample,
} from "./capture.js";
import { describeRecurrence } from "./recurrence.js";
import type { PlainDate } from "./values.js";

const OPTIONS = {
  today: CAPTURE_EXAMPLE_TODAY,
  projects: CAPTURE_EXAMPLE_PROJECTS,
  tags: CAPTURE_EXAMPLE_TAGS,
};

/** The example as a whole result, so a row that forgets a field still fails loudly. */
function expected(example: CaptureExample) {
  return {
    title: example.title,
    dueDate: example.dueDate ?? null,
    dueTime: example.dueTime ?? null,
    deferUntil: example.deferUntil ?? null,
    deadline: example.deadline ?? null,
    deadlineTime: example.deadlineTime ?? null,
    priority: example.priority ?? null,
    projectName: example.projectName ?? null,
    tagNames: example.tagNames ?? [],
    recurrence: example.recurrence ?? null,
    unknownProjects: example.unknownProjects ?? [],
    unknownTags: example.unknownTags ?? [],
  };
}

describe("parseCapture", () => {
  it("has a table big enough to be a specification", () => {
    // The plan asks for at least 60 phrases, negatives included.
    expect(CAPTURE_EXAMPLES.length).toBeGreaterThanOrEqual(60);
    const negatives = CAPTURE_EXAMPLES.filter(
      (example) => example.title === example.text.trim(),
    );
    expect(negatives.length).toBeGreaterThanOrEqual(15);
  });

  it.each(CAPTURE_EXAMPLES.map((example) => [example.text, example] as const))(
    "%s",
    (_text, example) => {
      const result = parseCapture(example.text, OPTIONS);
      expect({
        title: result.title,
        dueDate: result.dueDate,
        dueTime: result.dueTime,
        deferUntil: result.deferUntil,
        deadline: result.deadline,
        deadlineTime: result.deadlineTime,
        priority: result.priority,
        projectName: result.projectName,
        tagNames: result.tagNames,
        recurrence:
          result.recurrence === null ? null : describeRecurrence(result.recurrence),
        unknownProjects: result.unknownProjects,
        unknownTags: result.unknownTags,
      }).toEqual(expected(example));
    },
  );

  it("is deterministic: the same text and options give the same answer", () => {
    for (const example of CAPTURE_EXAMPLES) {
      expect(parseCapture(example.text, OPTIONS)).toEqual(
        parseCapture(example.text, OPTIONS),
      );
    }
  });

  it("never leaves a span outside the text it was read from", () => {
    for (const example of CAPTURE_EXAMPLES) {
      const result = parseCapture(example.text, OPTIONS);
      for (const span of result.spans) {
        expect(span.start).toBeGreaterThanOrEqual(0);
        expect(span.end).toBeLessThanOrEqual(example.text.length);
        expect(example.text.slice(span.start, span.end)).toBe(span.text);
        expect(span.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("reports spans in the order they were typed", () => {
    const result = parseCapture("Call Sam tomorrow 5pm p1 #Launch @phone", OPTIONS);
    expect(result.spans.map((span) => [span.kind, span.text, span.label])).toEqual([
      ["dueDate", "tomorrow 5pm", "Planned 2026-09-06 at 17:00"],
      ["priority", "p1", "Urgent"],
      ["project", "#Launch", "Project Launch"],
      ["tag", "@phone", "Tag phone"],
    ]);
  });

  it("labels a repeat with the rule it resolved to", () => {
    const result = parseCapture("Retro every 2 weeks on mon,thu", OPTIONS);
    expect(result.spans).toEqual([
      {
        kind: "recurrence",
        start: 6,
        end: 30,
        text: "every 2 weeks on mon,thu",
        value: "2 weeks on mon,thu",
        label: "Every 2 weeks on Mon, Thu",
        known: true,
      },
    ]);
  });

  it("marks an unknown project without taking it out of the title", () => {
    const result = parseCapture("Write copy #marketing", OPTIONS);
    expect(result.title).toBe("Write copy #marketing");
    expect(result.projectName).toBeNull();
    expect(result.unknownProjects).toEqual(["marketing"]);
    expect(result.spans).toEqual([
      {
        kind: "project",
        start: 11,
        end: 21,
        text: "#marketing",
        value: "marketing",
        label: 'No project "marketing"',
        known: false,
      },
    ]);
  });

  it("resolves nothing when the caller names no projects or tags", () => {
    const result = parseCapture("Write copy #Launch @phone", {
      today: CAPTURE_EXAMPLE_TODAY,
    });
    expect(result.projectName).toBeNull();
    expect(result.tagNames).toEqual([]);
    expect(result.unknownProjects).toEqual(["Launch"]);
    expect(result.unknownTags).toEqual(["phone"]);
    expect(result.title).toBe("Write copy #Launch @phone");
  });

  it("caps tags at the per-task limit and keeps the text of the ones it dropped", () => {
    const tags = Array.from({ length: 25 }, (_, index) => `t${index}`);
    const text = tags.map((tag) => `@${tag}`).join(" ");
    const result = parseCapture(`Tagged ${text}`, {
      today: CAPTURE_EXAMPLE_TODAY,
      tags,
    });
    expect(result.tagNames).toHaveLength(20);
    expect(result.title).toBe("Tagged");
  });

  it("resolves a weekday against the day it is asked about", () => {
    const monday = "2026-09-07" as PlainDate;
    expect(parseCapture("Gym monday", { today: monday }).dueDate).toBe("2026-09-14");
    expect(parseCapture("Gym next monday", { today: monday }).dueDate).toBe(
      "2026-09-14",
    );
    expect(parseCapture("Gym next week", { today: monday }).dueDate).toBe("2026-09-14");
    expect(parseCapture("Gym sunday", { today: monday }).dueDate).toBe("2026-09-13");
    expect(parseCapture("Gym next sunday", { today: monday }).dueDate).toBe(
      "2026-09-20",
    );
  });

  it("keeps the exact text when nothing is understood", () => {
    const text = "  Read  the   Bhagavad Gita  ";
    expect(parseCapture(text, OPTIONS).title).toBe("Read  the   Bhagavad Gita");
  });

  it("returns an empty title for blank input rather than throwing", () => {
    expect(parseCapture("   ", OPTIONS).title).toBe("");
  });
});

describe("removeSpan", () => {
  it("takes a chip's text and the space that held it", () => {
    const text = "Call Sam tomorrow 5pm p1 #Launch @phone";
    const result = parseCapture(text, OPTIONS);
    const priority = result.spans.find((span) => span.kind === "priority");
    expect(priority).toBeDefined();
    expect(removeSpan(text, priority!)).toBe("Call Sam tomorrow 5pm #Launch @phone");
  });

  it("handles a chip at either end of the line", () => {
    const first = parseCapture("tomorrow call Sam", OPTIONS).spans[0];
    expect(first).toBeDefined();
    expect(removeSpan("tomorrow call Sam", first!)).toBe("call Sam");

    const last = parseCapture("Call Sam @phone", OPTIONS).spans[0];
    expect(last).toBeDefined();
    expect(removeSpan("Call Sam @phone", last!)).toBe("Call Sam");
  });
});
