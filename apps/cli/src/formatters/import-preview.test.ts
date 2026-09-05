import type { ImportResultDto } from "@morrowlist/contracts";
import { describe, expect, it } from "vitest";

import { formatImportPreview } from "./output.js";

function result(overrides: Partial<ImportResultDto> = {}): ImportResultDto {
  return {
    dryRun: true,
    projectId: null,
    preview: {
      source: "trello",
      projectName: "Website Relaunch",
      counts: { statuses: 3, tasks: 12, subtasks: 4, tags: 2, skipped: 1 },
      statuses: [
        { name: "Backlog", category: "backlog", taskCount: 7 },
        { name: "Doing", category: "in_progress", taskCount: 1 },
        { name: "Done", category: "done", taskCount: 4 },
      ],
      tags: ["research", "content"],
      sample: [],
      ignoredFields: ["comments", "attachments"],
      issues: [{ row: 4, title: null, reason: "The card has no name." }],
    },
    ...overrides,
  };
}

describe("formatImportPreview", () => {
  it("leads with what a dry run would do, and names every skipped row", () => {
    const output = formatImportPreview(result());

    expect(output).toContain("Dry run: Website Relaunch would be created from trello.");
    expect(output).toContain("tasks      12");
    expect(output).toContain("Backlog  backlog      7 tasks");
    expect(output).toContain("Doing    in_progress  1 task");
    expect(output).toContain("Tags  #research #content");
    expect(output).toContain("Not imported  comments, attachments");
    expect(output).toContain("Skipped 1 row");
    expect(output).toContain("row 4  (no title): The card has no name.");
    expect(output).not.toContain("project  ");
  });

  it("reports a real import with the project it created", () => {
    const output = formatImportPreview(
      result({ dryRun: false, projectId: "01a04e0f-0000-7000-8000-000000000001" }),
    );

    expect(output).toContain("Imported Website Relaunch from trello.");
    expect(output).toContain("project  01a04e0f-0000-7000-8000-000000000001");
  });

  it("says nothing about tags, ignored fields, or skips when there are none", () => {
    const output = formatImportPreview(
      result({
        preview: {
          ...result().preview,
          tags: [],
          ignoredFields: [],
          issues: [],
          counts: { statuses: 1, tasks: 1, subtasks: 0, tags: 0, skipped: 0 },
        },
      }),
    );

    expect(output).not.toContain("Tags");
    expect(output).not.toContain("Not imported");
    expect(output).not.toContain("Skipped");
  });
});
