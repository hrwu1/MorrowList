import {
  createRuleRequestSchema,
  updateRuleRequestSchema,
} from "@morrowlist/contracts";
import { Command } from "commander";

import { printJson } from "../formatters/output.js";

import {
  fail,
  globalsOf,
  idempotency,
  parseJsonArgument,
  withClient,
} from "./shared.js";

/** Typed JSON is accepted at the scripting interface; no expression or code evaluation. */
export function ruleCommand(): Command {
  const rule = new Command("rule").description("Manage personal automation rules");
  rule
    .command("list")
    .description("List rules")
    .action(async (_options, command: Command) => {
      const globals = globalsOf(command);
      try {
        const result = await withClient(globals, (client) => client.listRules());
        if (globals.json) printJson({ ok: true, data: result });
        else
          process.stdout.write(
            result.data
              .map(
                (r) =>
                  `${r.id}  ${r.enabled ? "enabled" : "disabled"}  ${r.name}  ${r.trigger.type}`,
              )
              .join("\n") + "\n",
          );
      } catch (error) {
        fail(error, Boolean(globals.json));
      }
    });
  rule
    .command("create")
    .description(
      "Create a rule from typed JSON (name, trigger, actions, optional conditions)",
    )
    .argument("<definition>", "JSON rule definition")
    .action(async (definition: string, _options, command: Command) => {
      const globals = globalsOf(command);
      try {
        const body = parseJsonArgument(
          definition,
          createRuleRequestSchema,
          Boolean(globals.json),
        );
        const result = await withClient(globals, (client) =>
          client.createRule(body, idempotency()),
        );
        if (globals.json) printJson({ ok: true, data: result });
        else process.stdout.write(`${result.id}  ${result.name}\n`);
      } catch (error) {
        fail(error, Boolean(globals.json));
      }
    });
  rule
    .command("update")
    .description("Change a rule using typed JSON")
    .argument("<id>")
    .argument("<changes>", "JSON changed fields")
    .action(async (id: string, changes: string, _options, command: Command) => {
      const globals = globalsOf(command);
      try {
        const body = parseJsonArgument(
          changes,
          updateRuleRequestSchema,
          Boolean(globals.json),
        );
        const result = await withClient(globals, (client) =>
          client.updateRule(id, body, idempotency()),
        );
        if (globals.json) printJson({ ok: true, data: result });
        else process.stdout.write(`${result.id}  updated\n`);
      } catch (error) {
        fail(error, Boolean(globals.json));
      }
    });
  for (const enabled of [false, true])
    rule
      .command(enabled ? "enable" : "disable")
      .argument("<id>")
      .description(`${enabled ? "Enable" : "Disable"} a rule`)
      .action(async (id: string, _options, command: Command) => {
        const globals = globalsOf(command);
        try {
          const result = await withClient(globals, (client) =>
            client.updateRule(id, { enabled }, idempotency()),
          );
          if (globals.json) printJson({ ok: true, data: result });
          else process.stdout.write(`${id}  ${enabled ? "enabled" : "disabled"}\n`);
        } catch (error) {
          fail(error, Boolean(globals.json));
        }
      });
  rule
    .command("delete")
    .argument("<id>")
    .description("Delete a rule and its run log")
    .action(async (id: string, _options, command: Command) => {
      const globals = globalsOf(command);
      try {
        await withClient(globals, (client) => client.deleteRule(id, idempotency()));
        if (globals.json) printJson({ ok: true });
        else process.stdout.write(`${id}  deleted\n`);
      } catch (error) {
        fail(error, Boolean(globals.json));
      }
    });
  rule
    .command("runs")
    .argument("<id>")
    .description("Show the latest 50 runs")
    .action(async (id: string, _options, command: Command) => {
      const globals = globalsOf(command);
      try {
        const result = await withClient(globals, (client) => client.listRuleRuns(id));
        if (globals.json) printJson({ ok: true, data: result });
        else
          process.stdout.write(
            result.data
              .map(
                (r) =>
                  `${r.ranAt}  ${r.status}  ${r.taskId}${r.error ? `  ${r.error}` : ""}`,
              )
              .join("\n") + "\n",
          );
      } catch (error) {
        fail(error, Boolean(globals.json));
      }
    });
  rule
    .command("test")
    .argument("<id>")
    .argument("<taskId>")
    .description("Preview a simulated trigger without changing the task")
    .action(async (id: string, taskId: string, _options, command: Command) => {
      const globals = globalsOf(command);
      try {
        const result = await withClient(globals, (client) =>
          client.testRule(id, taskId),
        );
        if (globals.json) printJson({ ok: true, data: result });
        else
          process.stdout.write(
            `${result.matches ? "Matches" : "Does not match"}: ${result.actions.map((a) => a.type).join(", ")}\n${result.explanation}\n`,
          );
      } catch (error) {
        fail(error, Boolean(globals.json));
      }
    });
  return rule;
}
