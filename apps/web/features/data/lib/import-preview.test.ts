import type { ImportPreviewDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import {
  MAX_IMPORT_MB,
  describeSampleTask,
  importButtonLabel,
  isTooLarge,
  previewCounts,
  sourceForFilename,
  sourceLabel,
} from "./import-preview";

function preview(overrides: Partial<ImportPreviewDto> = {}): ImportPreviewDto {
  return {
    source: "trello",
    projectName: "Website Relaunch",
    counts: { statuses: 3, tasks: 12, subtasks: 4, tags: 2, skipped: 1 },
    statuses: [],
    tags: [],
    sample: [],
    ignoredFields: [],
    issues: [],
    ...overrides,
  };
}

describe("sourceForFilename", () => {
  it("reads the importer from the extension, and admits when it cannot", () => {
    expect(sourceForFilename("board.json")).toBe("trello");
    expect(sourceForFilename("TASKS.CSV")).toBe("csv");
    expect(sourceForFilename("notes.txt")).toBeNull();
  });
});

describe("previewCounts", () => {
  it("lists the headline numbers in the order a person checks them", () => {
    expect(previewCounts(preview())).toEqual([
      { label: "Columns", value: 3 },
      { label: "Tasks", value: 12 },
      { label: "Subtasks", value: 4 },
      { label: "Tags", value: 2 },
      { label: "Skipped", value: 1 },
    ]);
  });
});

describe("describeSampleTask", () => {
  it("says where a task lands and what will happen to it", () => {
    expect(
      describeSampleTask({
        title: "Interview users",
        statusName: "This week",
        tags: ["research"],
        dueDate: "2026-09-14",
        isCompleted: false,
        isArchived: false,
        subtaskCount: 3,
      }),
    ).toBe("This week · due 2026-09-14 · #research · 3 subtasks");
  });

  it("names the two states that surprise people", () => {
    const base = {
      title: "Old spike",
      statusName: null,
      tags: [],
      dueDate: null,
      subtaskCount: 0,
    };
    expect(describeSampleTask({ ...base, isCompleted: true, isArchived: false })).toBe(
      "first column · arrives completed",
    );
    expect(describeSampleTask({ ...base, isCompleted: true, isArchived: true })).toBe(
      "first column · goes to Trash",
    );
  });
});

describe("importButtonLabel", () => {
  it("confirms the total at the moment of pressing", () => {
    expect(importButtonLabel(preview())).toBe("Import 16 tasks into Website Relaunch");
    expect(
      importButtonLabel(
        preview({
          counts: { statuses: 1, tasks: 1, subtasks: 0, tags: 0, skipped: 0 },
        }),
      ),
    ).toBe("Import 1 task into Website Relaunch");
  });
});

describe("file limits and labels", () => {
  it("rejects a file over the API's cap", () => {
    expect(isTooLarge(MAX_IMPORT_MB * 1_000_000)).toBe(false);
    expect(isTooLarge(MAX_IMPORT_MB * 1_000_000 + 1)).toBe(true);
  });

  it("names each source the way the page does", () => {
    expect(sourceLabel("trello")).toBe("Trello board");
    expect(sourceLabel("csv")).toBe("CSV file");
  });
});
