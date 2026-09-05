import { describe, expect, it } from "vitest";

import {
  PROJECT_BOARD_TASK_LIMIT,
  projectBoardQuerySchema,
  projectBoardResponseSchema,
} from "./project.js";

const ID = "0198f0a0-0000-7000-8000-000000000000";
const STATUS_ID = "0198f0a0-0000-7000-8000-000000000001";

describe("projectBoardQuerySchema", () => {
  it("defaults to the explicit board cap", () => {
    expect(projectBoardQuerySchema.parse({}).limit).toBe(PROJECT_BOARD_TASK_LIMIT);
  });

  it("rejects a request above the board cap", () => {
    expect(
      projectBoardQuerySchema.safeParse({ limit: PROJECT_BOARD_TASK_LIMIT + 1 })
        .success,
    ).toBe(false);
  });
});

describe("projectBoardResponseSchema", () => {
  it("requires an explicit truncation signal", () => {
    const base = {
      data: {
        project: {
          id: ID,
          workspaceId: ID,
          name: "Research launch",
          slug: "research-launch",
          descriptionMd: null,
          colorToken: "blue",
          icon: null,
          archivedAt: null,
          version: 1,
          createdAt: "2026-08-30T12:00:00.000Z",
          updatedAt: "2026-08-30T12:00:00.000Z",
        },
        statuses: [
          {
            id: STATUS_ID,
            projectId: ID,
            name: "Ready",
            category: "ready",
            rank: "a0",
            colorToken: "blue",
            wipLimit: null,
            isDefault: true,
            isTerminal: false,
            policyMd: null,
            archivedAt: null,
            version: 1,
          },
        ],
        tasks: [],
        swimlaneBy: "none",
        lanes: [
          {
            key: "all",
            label: "All cards",
            value: null,
            writable: false,
            colorToken: null,
            count: 0,
          },
        ],
        placements: [],
      },
    };

    expect(projectBoardResponseSchema.safeParse(base).success).toBe(false);
    expect(
      projectBoardResponseSchema.parse({
        ...base,
        page: { hasMore: true, truncated: true },
      }).page,
    ).toEqual({ hasMore: true, truncated: true });
  });
});
