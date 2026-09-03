import { Command } from "commander";

import { authCommand } from "./commands/auth.js";
import { tagCommand } from "./commands/tag.js";
import { taskCommand } from "./commands/task.js";
import { todayCommand } from "./commands/today.js";
import { EXIT, printError } from "./formatters/output.js";

/**
 * `morrow` (CLI-001, spec 21).
 *
 * Every MVP capability is reachable here because the CLI speaks the same public REST API
 * as the web app (ADR-005). Human output goes to stdout; use `--json` for scripts.
 */

const VERSION = "0.0.0";

const program = new Command()
  .name("morrow")
  .description("MorrowList from the command line")
  .version(VERSION, "-v, --version")
  .option("--json", "emit the machine-readable envelope on stdout")
  .option("--profile <name>", "configuration profile to use")
  .option("--base-url <url>", "override the API base URL")
  .option("--api-key <key>", "override the API key")
  // Stored as `workspaceId` so it matches the ResolveOptions field the profile uses.
  .option("--workspace-id <id>", "override the workspace")
  .showHelpAfterError();

program.addCommand(authCommand());
program.addCommand(taskCommand());
program.addCommand(todayCommand());
program.addCommand(tagCommand());

try {
  await program.parseAsync(process.argv);
} catch (error) {
  // Commander already reported usage errors; anything reaching here is unexpected.
  printError(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT.usage);
}
