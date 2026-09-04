import { Command } from "commander";

import { formatSearchResults, printError, printJson } from "../formatters/output.js";

import { fail, globalsOf, withClient } from "./shared.js";
import { WHERE_HELP } from "./where.js";

/**
 * `morrow search "<query>"` (spec 21.3, 9.8): words plus the operator grammar, the same
 * request the web search box sends.
 */
export function searchCommand(): Command {
  return new Command("search")
    .description(
      `Search tasks and projects by words, task key, or tag name; ${WHERE_HELP}`,
    )
    .argument("<query...>", "words and operators, e.g. budget due:overdue")
    .option("--limit <n>", "page size, 1-200", "50")
    .option("--cursor <cursor>", "continue from a previous page's nextCursor")
    .action(async (parts: string[], options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const page = await withClient(globals, (client) =>
          client.search({
            q: parts.join(" "),
            limit: Number(options.limit),
            ...(options.cursor ? { cursor: options.cursor } : {}),
          }),
        );

        if (json) printJson({ ok: true, data: page });
        else {
          process.stdout.write(`${formatSearchResults(page)}\n`);
          if (page.page.nextCursor)
            printError(`more: --cursor ${page.page.nextCursor}`);
        }
      } catch (error) {
        fail(error, json);
      }
    });
}
