import { describe, expect, it } from "vitest";

import { DEFAULT_API_BASE_URL, resolveClientEnvironment } from "./environment.js";

describe("shared client environment", () => {
  it("uses the development server default and preserves selected profile values", () => {
    expect(resolveClientEnvironment({}).baseUrl).toBe(DEFAULT_API_BASE_URL);
    expect(DEFAULT_API_BASE_URL).toBe("http://localhost:3200/api/v1");
    expect(
      resolveClientEnvironment(
        {},
        {
          baseUrl: "https://profile.test/api/v1",
          apiKey: "profile-key",
          workspaceId: "profile-workspace",
        },
      ),
    ).toEqual({
      baseUrl: "https://profile.test/api/v1",
      apiKey: "profile-key",
      workspaceId: "profile-workspace",
    });
  });

  it("gives environment values precedence and supports the older MCP workspace name", () => {
    const env = {
      MORROW_BASE_URL: "https://env.test/api/v1",
      MORROW_API_KEY: "env-key",
      MORROW_WORKSPACE: "legacy-workspace",
    };
    expect(resolveClientEnvironment(env, { workspaceId: "profile-workspace" })).toEqual(
      {
        baseUrl: env.MORROW_BASE_URL,
        apiKey: "env-key",
        workspaceId: "legacy-workspace",
      },
    );
    expect(
      resolveClientEnvironment({ ...env, MORROW_WORKSPACE_ID: "canonical-workspace" })
        .workspaceId,
    ).toBe("canonical-workspace");
  });
});
