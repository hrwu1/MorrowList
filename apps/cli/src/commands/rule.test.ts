import { afterEach, describe, expect, it, vi } from "vitest";

import { createProgram } from "../program.js";

import type * as shared from "./shared.js";

const client = vi.hoisted(() => ({
  createRule: vi.fn(async () => ({ id: "rule-id", name: "Plan today" })),
  listRules: vi.fn(async () => ({ data: [] })),
  updateRule: vi.fn(async () => ({ id: "rule-id", enabled: false })),
  testRule: vi.fn(async () => ({ matches: true, actions: [], explanation: "Preview" })),
  listRuleRuns: vi.fn(async () => ({ data: [] })),
  deleteRule: vi.fn(async () => {}),
}));
vi.mock("./shared.js", async (original) => ({
  ...(await original<typeof shared>()),
  withClient: async (
    _options: unknown,
    fn: (value: typeof client) => Promise<unknown>,
  ) => fn(client),
  fail: (error: unknown) => {
    throw error;
  },
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
describe("rule CLI argv", () => {
  it.each(["not json", "{}", '{"name":"Bad","trigger":{"type":"unknown"}}'])(
    "reports invalid local definitions as usage errors: %s",
    async (definition) => {
      const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const exit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      await expect(
        createProgram().parseAsync(["--json", "rule", "create", definition], {
          from: "user",
        }),
      ).rejects.toThrow("exit");
      expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
        ok: false,
        error: { code: "USAGE" },
      });
      expect(exit).toHaveBeenCalledWith(2);
      expect(client.createRule).not.toHaveBeenCalled();
    },
  );
  it("parses typed creation, defaults optional fields and prints a JSON envelope", async () => {
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await createProgram().parseAsync(
      [
        "--json",
        "rule",
        "create",
        JSON.stringify({
          name: "Plan today",
          trigger: { type: "due.today" },
          actions: [{ type: "add_to_day" }],
        }),
      ],
      { from: "user" },
    );
    expect(client.createRule).toHaveBeenCalledWith(
      {
        name: "Plan today",
        trigger: { type: "due.today" },
        actions: [{ type: "add_to_day" }],
        conditions: [],
        enabled: true,
      },
      { idempotencyKey: expect.any(String) },
    );
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      data: { id: "rule-id" },
    });
  });
  it("lists, disables, previews and reads runs using the matching client methods", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    for (const args of [
      ["list"],
      ["disable", "rule-id"],
      ["test", "rule-id", "task-id"],
      ["runs", "rule-id"],
    ])
      await createProgram().parseAsync(["--json", "rule", ...args], { from: "user" });
    expect(client.listRules).toHaveBeenCalledOnce();
    expect(client.updateRule).toHaveBeenCalledWith(
      "rule-id",
      { enabled: false },
      { idempotencyKey: expect.any(String) },
    );
    expect(client.testRule).toHaveBeenCalledWith("rule-id", "task-id");
    expect(client.listRuleRuns).toHaveBeenCalledWith("rule-id");
  });
});
