import { afterEach, describe, expect, it, vi } from "vitest";

import { createProgram } from "../program.js";

import type * as shared from "./shared.js";

const client = vi.hoisted(() => ({
  getTask: vi.fn(async () => ({ id: "task-id", key: "ML-000001", version: 7 })),
  deleteTask: vi.fn(async () => ({ id: "task-id", key: "ML-000001", version: 8 })),
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

describe("single-task deletion", () => {
  it.each([
    [[], 7],
    [["--expected-version", "5"], 5],
  ] as const)(
    "preserves the observed or explicitly supplied version: %o",
    async (flags, expectedVersion) => {
      vi.spyOn(process.stdout, "write").mockReturnValue(true);
      await createProgram().parseAsync(
        ["--json", "task", "delete", "ML-000001", ...flags],
        { from: "user" },
      );
      expect(client.deleteTask).toHaveBeenCalledWith("task-id", expectedVersion, {
        idempotencyKey: expect.any(String),
      });
    },
  );
});
