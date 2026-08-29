import { describe, expect, it } from "vitest";

import {
  DEFAULT_BASE_URL,
  redactKey,
  resolveProfile,
  type ConfigFile,
} from "./profile.js";

const config: ConfigFile = {
  defaultProfile: "default",
  profiles: {
    default: {
      baseUrl: "https://morrow.example.com/api/v1",
      apiKey: "ml_live_default_key",
      workspaceId: "ws-default",
    },
    work: { baseUrl: "https://work.example.com/api/v1", apiKey: "ml_live_work_key" },
  },
};

describe("resolveProfile", () => {
  it("uses the default profile when nothing is specified", () => {
    const resolved = resolveProfile(config, {}, {});

    expect(resolved.name).toBe("default");
    expect(resolved.baseUrl).toBe("https://morrow.example.com/api/v1");
    expect(resolved.workspaceId).toBe("ws-default");
  });

  it("selects a named profile", () => {
    const resolved = resolveProfile(config, { profile: "work" }, {});

    expect(resolved.baseUrl).toBe("https://work.example.com/api/v1");
    expect(resolved.workspaceId).toBeUndefined();
  });

  it("lets the environment override the file", () => {
    const resolved = resolveProfile(config, {}, {
      MORROW_BASE_URL: "http://localhost:3000/api/v1",
      MORROW_API_KEY: "from-env",
    } as NodeJS.ProcessEnv);

    expect(resolved.baseUrl).toBe("http://localhost:3000/api/v1");
    expect(resolved.apiKey).toBe("from-env");
  });

  it("lets flags override the environment", () => {
    const resolved = resolveProfile(
      config,
      { baseUrl: "http://flag.example/api/v1", apiKey: "from-flag" },
      {
        MORROW_BASE_URL: "http://env.example/api/v1",
        MORROW_API_KEY: "from-env",
      } as NodeJS.ProcessEnv,
    );

    expect(resolved.baseUrl).toBe("http://flag.example/api/v1");
    expect(resolved.apiKey).toBe("from-flag");
  });

  it("selects a profile from the environment", () => {
    const resolved = resolveProfile(config, {}, {
      MORROW_PROFILE: "work",
    } as NodeJS.ProcessEnv);

    expect(resolved.name).toBe("work");
  });

  it("falls back to the default base URL for an unknown profile", () => {
    const resolved = resolveProfile(config, { profile: "missing" }, {});

    expect(resolved.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(resolved.apiKey).toBeUndefined();
  });
});

describe("redactKey", () => {
  it("never reveals a usable key", () => {
    expect(redactKey("ml_live_abcdefghijklmnop")).toBe("ml_l…mnop");
    expect(redactKey("short")).toBe("****");
    expect(redactKey(undefined)).toBe("(not set)");
  });
});
