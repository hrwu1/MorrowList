import { SCOPE_PRESETS } from "@morrowlist/contracts";
import { Command } from "commander";

import { EXIT, printJson } from "../formatters/output.js";

import { globalsOf } from "./shared.js";
import { WHERE_HELP } from "./where.js";

/**
 * `morrow usage` (GAP-18): the whole CLI in a few hundred tokens.
 *
 * `--help` is written for a person scrolling; this is written for an agent that has one
 * context window and needs to know what exists, what shape the answers come back in, and
 * what an exit code means — in one read. The command map is walked out of the real
 * Commander tree, so a command that is added and not documented cannot happen.
 */

const EXIT_MEANINGS: Record<number, string> = {
  [EXIT.success]: "ok",
  [EXIT.usage]: "usage error",
  [EXIT.authentication]: "auth",
  [EXIT.notFound]: "not found",
  [EXIT.conflict]: "conflict",
  [EXIT.validation]: "invalid",
  [EXIT.server]: "server",
  [EXIT.network]: "network",
};

const EXAMPLES = [
  `morrow task add "Draft the brief" --due 2026-09-15 --tag focus --json`,
  `morrow task list --where 'is:open due:today priority:high' --json`,
  `morrow task show ML-000142 --json`,
  `morrow task update ML-000142 -p urgent --expected-version 7 --json`,
  `morrow task complete ML-000142 --json`,
  `morrow search "quarterly plan" --json`,
];

/** One line per top-level command: its name, then the verbs underneath it. */
export function commandMap(root: Command): string[] {
  const named = root.commands.filter((command) => !command.name().startsWith("help"));
  const width = Math.max(...named.map((command) => command.name().length));
  return named.map((command) => {
    const children = command.commands.map((child) => child.name());
    // A leaf command has no verbs to list, so its own description stands in — trimmed,
    // because this map is read by something with a context window.
    const detail =
      children.length > 0 ? children.join(" ") : firstSentence(command.description());
    return `  ${command.name().padEnd(width)}  ${detail}`;
  });
}

function firstSentence(text: string): string {
  const cut = text.search(/[;.]/);
  return cut === -1 ? text : text.slice(0, cut);
}

export function usageText(root: Command): string {
  return [
    "morrow — MorrowList from the command line. Same REST API as the web app.",
    "",
    "Every command accepts --json: results on stdout, diagnostics on stderr.",
    "Mutations send an idempotency key automatically; pass --expected-version to fail",
    "rather than overwrite a concurrent edit.",
    "",
    "Commands",
    ...commandMap(root),
    "",
    "Filters for `task list --where` and `search`",
    `  ${WHERE_HELP}`,
    `  free text is search only; a list takes operators`,
    "",
    "JSON envelope",
    `  ok    {"ok":true,"data":<result>,"warnings":[{"code":"…","message":"…"}]}`,
    `  fail  {"ok":false,"error":{"code":"…","message":"…","details":{}}}`,
    "",
    "Exit codes",
    `  ${Object.entries(EXIT_MEANINGS)
      .map(([code, meaning]) => `${code} ${meaning}`)
      .join("  ")}`,
    "",
    "Examples",
    ...EXAMPLES.map((example) => `  ${example}`),
    "",
    "API key scopes",
    ...Object.entries(SCOPE_PRESETS).map(
      ([name, scopes]) => `  ${name.padEnd(8)}  ${scopes.join(" ")}`,
    ),
    "",
    "Configuration (flags beat env, env beats the profile)",
    "  MORROW_BASE_URL  MORROW_API_KEY  MORROW_WORKSPACE_ID  MORROW_PROFILE",
  ].join("\n");
}

/** The same content as data, for a caller that would rather not parse prose. */
export function usageData(root: Command) {
  return {
    commands: root.commands
      .filter((command) => !command.name().startsWith("help"))
      .map((command) => ({
        name: command.name(),
        description: command.description(),
        subcommands: command.commands.map((child) => ({
          name: child.name(),
          description: child.description(),
        })),
      })),
    envelope: {
      success: { ok: true, data: "<result>", warnings: [{ code: "", message: "" }] },
      failure: { ok: false, error: { code: "", message: "", details: {} } },
    },
    exitCodes: EXIT_MEANINGS,
    filters: WHERE_HELP,
    examples: EXAMPLES,
    scopePresets: SCOPE_PRESETS,
    environment: [
      "MORROW_BASE_URL",
      "MORROW_API_KEY",
      "MORROW_WORKSPACE_ID",
      "MORROW_PROFILE",
    ],
  };
}

export function usageCommand(): Command {
  return new Command("usage")
    .description("Print the whole CLI compactly: commands, envelope, exit codes")
    .action((_options, command: Command) => {
      // `usage` sits directly under the root, so the root is its parent.
      const root = command.parent ?? command;
      if (globalsOf(command).json) printJson({ ok: true, data: usageData(root) });
      else process.stdout.write(`${usageText(root)}\n`);
    });
}
