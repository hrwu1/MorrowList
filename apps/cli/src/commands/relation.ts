import type { ApiClient } from "@morrowlist/api-client";
import type { RelationType, TaskDto, TaskRelationDto } from "@morrowlist/contracts";
import { Command } from "commander";

import { printJson } from "../formatters/output.js";

import { fail, globalsOf, idempotency, usageFailure, withClient } from "./shared.js";

/**
 * `morrow relation …` (CLI-006, spec 8.4, 21.3). Relations read the way people say them:
 * `morrow relation add ML-141 blocks ML-142`. Tasks are addressed by key or id.
 */

const TYPE_WORDS: Record<string, RelationType> = {
  blocks: "blocks",
  "related-to": "related_to",
  related_to: "related_to",
  relates: "related_to",
};

function parseType(word: string, json: boolean): RelationType {
  const type = TYPE_WORDS[word.toLowerCase()];
  if (!type) {
    usageFailure(
      `Unknown relation type "${word}". Use "blocks" or "related-to".`,
      json,
    );
  }
  return type;
}

/** One line per relation, from the task's own point of view. */
export function formatRelations(task: TaskDto): string {
  if (task.relations.length === 0) return "No relations.";
  return task.relations
    .map((relation) => `${describe(relation, task.id)}  ${line(relation)}`)
    .join("\n");
}

function describe(relation: TaskRelationDto, taskId: string): string {
  if (relation.type === "related_to") return "related to";
  return relation.sourceTaskId === taskId ? "blocks    " : "blocked by";
}

function line(relation: TaskRelationDto): string {
  const done = relation.task.isCompleted ? "x" : " ";
  return `[${done}] ${relation.task.key}  ${relation.task.title}`;
}

async function resolvePair(client: ApiClient, left: string, right: string) {
  const [source, target] = await Promise.all([
    client.getTask(left),
    client.getTask(right),
  ]);
  return { source, target };
}

export function relationCommand(): Command {
  const relation = new Command("relation").description(
    "Relate tasks: blockers and related work",
  );

  relation
    .command("add")
    .description("Relate two tasks, e.g. `morrow relation add ML-141 blocks ML-142`")
    .argument("<source>", "task id or key")
    .argument("<type>", "blocks | related-to")
    .argument("<target>", "task id or key")
    .action(async (left: string, word: string, right: string, _options, command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      const type = parseType(word, json);
      try {
        const updated = await withClient(globals, async (client) => {
          const { source, target } = await resolvePair(client, left, right);
          return client.addTaskRelation(
            source.id,
            { type, targetTaskId: target.id },
            idempotency(),
          );
        });

        if (json) printJson({ ok: true, data: updated });
        else process.stdout.write(`${updated.key}\n${formatRelations(updated)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  relation
    .command("remove")
    .description("Remove a relation, named the same way it was added")
    .argument("<source>", "task id or key")
    .argument("<type>", "blocks | related-to")
    .argument("<target>", "task id or key")
    .action(async (left: string, word: string, right: string, _options, command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      const type = parseType(word, json);
      try {
        const updated = await withClient(globals, async (client) => {
          const { source, target } = await resolvePair(client, left, right);
          const match = source.relations.find(
            (candidate) =>
              candidate.type === type &&
              candidate.task.id === target.id &&
              (type === "related_to" || candidate.sourceTaskId === source.id),
          );
          if (!match) {
            usageFailure(
              `${source.key} has no "${word}" relation to ${target.key}.`,
              json,
            );
          }
          return client.removeTaskRelation(source.id, match.id, idempotency());
        });

        if (json) printJson({ ok: true, data: updated });
        else process.stdout.write(`${updated.key}\n${formatRelations(updated)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  relation
    .command("list")
    .description("List a task's relations")
    .argument("<idOrKey>")
    .action(async (idOrKey: string, _options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const task = await withClient(globals, (client) => client.getTask(idOrKey));

        if (json) printJson({ ok: true, data: task.relations });
        else process.stdout.write(`${formatRelations(task)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  return relation;
}
