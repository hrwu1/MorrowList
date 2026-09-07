import { describe, expect, it } from "vitest";

import { EnvironmentValidationError, parseServerEnv } from "./env.js";

const base = {
  DATABASE_URL: "postgresql://user@localhost:5432/morrowlist",
};

describe("parseServerEnv", () => {
  it("applies documented defaults when only the database URL is supplied", () => {
    const env = parseServerEnv(base as NodeJS.ProcessEnv);

    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3200);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.TRASH_RETENTION_DAYS).toBe(30);
    expect(env.AUTH_TRUSTED_ORIGINS).toEqual(["http://localhost:3200"]);
  });

  it("rejects a non-postgres database URL", () => {
    expect(() =>
      parseServerEnv({
        ...base,
        DATABASE_URL: "mysql://localhost/db",
      } as NodeJS.ProcessEnv),
    ).toThrow(EnvironmentValidationError);
  });

  it("requires AUTH_SECRET in production", () => {
    expect(() =>
      parseServerEnv({ ...base, NODE_ENV: "production" } as NodeJS.ProcessEnv),
    ).toThrow(/AUTH_SECRET is required in production/);
  });

  it("starts without GitHub sign-in when both credentials are absent", () => {
    const env = parseServerEnv(base as NodeJS.ProcessEnv);

    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
    expect(env.GITHUB_CLIENT_SECRET).toBeUndefined();
  });

  it("rejects a half-configured GitHub provider", () => {
    expect(() =>
      parseServerEnv({ ...base, GITHUB_CLIENT_ID: "abc" } as NodeJS.ProcessEnv),
    ).toThrow(/must be set together or both omitted/);
  });

  it("parses a comma separated trusted origin list", () => {
    const env = parseServerEnv({
      ...base,
      AUTH_TRUSTED_ORIGINS: "http://localhost:3200, https://app.example.com",
    } as NodeJS.ProcessEnv);

    expect(env.AUTH_TRUSTED_ORIGINS).toEqual([
      "http://localhost:3200",
      "https://app.example.com",
    ]);
  });
});

it("enables inbound email only with a valid receiving domain, ingress secret and application secret", () => {
  const valid = {
    ...base,
    AUTH_SECRET: "a".repeat(32),
    INBOUND_EMAIL_DOMAIN: "inbox.example.com",
    INBOUND_EMAIL_SECRET: "b".repeat(32),
  };
  expect(parseServerEnv(valid).INBOUND_EMAIL_DOMAIN).toBe("inbox.example.com");
  for (const values of [
    { ...valid, AUTH_SECRET: "" },
    { ...valid, INBOUND_EMAIL_SECRET: "short" },
    { ...valid, INBOUND_EMAIL_DOMAIN: "https://inbox.example.com" },
    { ...valid, INBOUND_EMAIL_SECRET: "" },
  ])
    expect(() => parseServerEnv(values)).toThrow(EnvironmentValidationError);
});
