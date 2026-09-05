import { SCOPE_PRESETS } from "@morrowlist/contracts";
import type { Command } from "commander";
import { describe, expect, it } from "vitest";

import { createProgram } from "../program.js";

import { commandMap, usageData, usageText } from "./usage.js";

/**
 * `morrow usage` is the CLI's contract with an agent, so these tests hold it to three
 * things: it must be complete, it must be small, and it must not describe a command that
 * does not exist.
 */

const program = createProgram();
const text = usageText(program);

/** Every leaf command a caller can actually run. */
function leafNames(root: Command): string[] {
  return root.commands.flatMap((command) =>
    command.commands.length === 0
      ? [command.name()]
      : command.commands.map((child) => `${command.name()} ${child.name()}`),
  );
}

describe("usageText", () => {
  it("lists every top-level command and every verb underneath it", () => {
    for (const command of program.commands) {
      expect(text, command.name()).toContain(command.name());
      for (const child of command.commands) {
        expect(
          commandMap(program).join("\n"),
          `${command.name()} ${child.name()}`,
        ).toContain(child.name());
      }
    }
  });

  it("stays small enough to paste into a prompt", () => {
    // A few hundred tokens is the promise; four characters per token, generously.
    expect(text.length).toBeLessThan(4000);
    expect(text.split("\n").length).toBeLessThan(70);
  });

  it("gives an agent the three things it cannot guess", () => {
    // The envelope it must parse...
    expect(text).toContain(`{"ok":true,"data":<result>`);
    expect(text).toContain(`{"ok":false,"error":`);
    // ...what an exit code means...
    expect(text).toContain("0 ok");
    expect(text).toContain("5 conflict");
    // ...and the filter grammar, which is not guessable from flags alone.
    expect(text).toContain("is:open|done|blocked|deferred");
  });

  it("names only commands that exist, in its examples", () => {
    const leaves = new Set(leafNames(program));
    const examples = usageData(program).examples;
    expect(examples.length).toBeGreaterThan(3);

    for (const example of examples) {
      const [, group, verb] = example.split(" ");
      const candidate = `${group} ${verb}`;
      expect(
        leaves.has(candidate) || leaves.has(group as string),
        `${example} → ${candidate}`,
      ).toBe(true);
      // Every example is machine-readable, because that is the audience.
      expect(example, example).toContain("--json");
    }
  });

  it("publishes the API key scope presets, agent included", () => {
    expect(text).toContain("agent");
    expect(text).toContain(SCOPE_PRESETS.agent.join(" "));
    // An agent key must not look like it can reconfigure the workspace.
    expect(text).not.toContain("workspace:write");
  });
});

describe("usageData", () => {
  it("carries the same content as the prose, as data", () => {
    const data = usageData(program);

    expect(data.commands.map((command) => command.name)).toEqual(
      program.commands.map((command) => command.name()),
    );
    expect(data.exitCodes[0]).toBe("ok");
    expect(data.scopePresets.agent).toEqual(SCOPE_PRESETS.agent);
    expect(data.environment).toContain("MORROW_API_KEY");
  });

  it("describes both envelope shapes so a caller can branch on `ok`", () => {
    const { envelope } = usageData(program);
    expect(envelope.success.ok).toBe(true);
    expect(envelope.failure.ok).toBe(false);
    expect(envelope.failure.error).toHaveProperty("code");
  });
});
