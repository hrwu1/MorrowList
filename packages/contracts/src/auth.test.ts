import { describe, expect, it } from "vitest";

import { SCOPES, SCOPE_PRESETS } from "./auth.js";

/**
 * The presets are a security boundary, so what they leave out matters more than what
 * they contain. These assertions are the reason to read the file.
 */
describe("SCOPE_PRESETS", () => {
  it("grants nothing that is not a known scope", () => {
    const known = new Set<string>(Object.values(SCOPES));
    for (const [name, scopes] of Object.entries(SCOPE_PRESETS)) {
      expect(scopes.length, name).toBeGreaterThan(0);
      expect(new Set(scopes).size, name).toBe(scopes.length);
      for (const scope of scopes)
        expect(known.has(scope), `${name}: ${scope}`).toBe(true);
    }
  });

  it("keeps an agent out of workspace configuration and out of project destruction", () => {
    const agent = new Set<string>(SCOPE_PRESETS.agent);

    // workspace:write manages webhook endpoints; projects:write archives projects.
    expect(agent.has(SCOPES.workspaceWrite)).toBe(false);
    expect(agent.has(SCOPES.projectsWrite)).toBe(false);
    // But it can do the work it was invited to do.
    expect(agent.has(SCOPES.tasksRead)).toBe(true);
    expect(agent.has(SCOPES.tasksWrite)).toBe(true);
    expect(agent.has(SCOPES.tagsWrite)).toBe(true);
  });

  it("makes readonly a strict subset of agent, and agent of cli", () => {
    const agent = new Set<string>(SCOPE_PRESETS.agent);
    const cli = new Set<string>(SCOPE_PRESETS.cli);

    for (const scope of SCOPE_PRESETS.readonly) expect(agent.has(scope)).toBe(true);
    for (const scope of SCOPE_PRESETS.agent) expect(cli.has(scope)).toBe(true);
    expect(SCOPE_PRESETS.readonly.length).toBeLessThan(SCOPE_PRESETS.agent.length);
    expect(SCOPE_PRESETS.agent.length).toBeLessThan(SCOPE_PRESETS.cli.length);
  });

  it("reserves calendar credential issuance for the CLI preset", () => {
    expect(SCOPE_PRESETS.cli).toContain(SCOPES.calendarWrite);
    expect(SCOPE_PRESETS.agent).not.toContain(SCOPES.calendarWrite);
    expect(SCOPE_PRESETS.readonly).not.toContain(SCOPES.calendarWrite);
  });

  it("never grants workspace:write from a preset at all", () => {
    // A key that can manage webhook endpoints or workspace settings is created
    // deliberately, one scope at a time — never by picking a convenient preset.
    for (const [name, scopes] of Object.entries(SCOPE_PRESETS)) {
      expect(scopes as readonly string[], name).not.toContain(SCOPES.workspaceWrite);
    }
  });
});
