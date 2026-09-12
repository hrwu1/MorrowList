import { TASK_CSV_COLUMNS } from "@morrowlist/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProgram } from "../program.js";

import type * as shared from "./shared.js";

const client = vi.hoisted(() => ({
  listTags: vi.fn(async () => ({ data: [] })),
  listFields: vi.fn(async () => ({ data: [{ key: "effort" }] })),
  exportTasksCsv: vi.fn(async () => "exported rows\r\n"),
}));
vi.mock("./shared.js", async (original) => ({
  ...(await original<typeof shared>()),
  withClient: async (
    _options: unknown,
    run: (api: typeof client) => Promise<unknown>,
  ) => run(client),
  fail: (error: unknown) => {
    throw error;
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("CSV export selection", () => {
  it("exports only column headers for an unknown tag instead of widening the selection", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await createProgram().parseAsync(["export", "--csv", "--where", "tag:missing"], {
      from: "user",
    });
    expect(client.exportTasksCsv).not.toHaveBeenCalled();
    expect(String(stdout.mock.calls[0]?.[0])).toBe(
      [...TASK_CSV_COLUMNS, "field:effort"].join(",") + "\r\n",
    );
  });

  it("preserves custom-field and regular filters for a nonempty selection", async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await createProgram().parseAsync(
      ["export", "--csv", "--where", "field:effort:gt:3 priority:high"],
      { from: "user" },
    );
    expect(client.exportTasksCsv).toHaveBeenCalledWith({
      priority: "high",
      fields: [{ key: "effort", op: "gt", value: "3", upper: null }],
    });
  });
});
