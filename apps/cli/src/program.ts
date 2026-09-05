import { Command } from "commander";

import { authCommand } from "./commands/auth.js";
import { exportCommand, importCommand } from "./commands/data.js";
import { fieldCommand } from "./commands/field.js";
import { notificationsCommand } from "./commands/notifications.js";
import { projectCommand } from "./commands/project.js";
import { relationCommand } from "./commands/relation.js";
import { searchCommand } from "./commands/search.js";
import { statusCommand } from "./commands/status.js";
import { tagCommand } from "./commands/tag.js";
import { taskCommand } from "./commands/task.js";
import { todayCommand } from "./commands/today.js";
import { usageCommand } from "./commands/usage.js";
import { viewCommand } from "./commands/view.js";
import { webhookCommand } from "./commands/webhook.js";
import { workspaceCommand } from "./commands/workspace.js";

/**
 * `morrow` (CLI-001, spec 21).
 *
 * Every MVP capability is reachable here because the CLI speaks the same public REST API
 * as the web app (ADR-005). Human output goes to stdout; use `--json` for scripts.
 *
 * Built by a function rather than at module scope so `morrow usage` and its tests can
 * walk the real command tree instead of a copy of it.
 */

export const VERSION = "0.0.0";

export function createProgram(): Command {
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
  program.addCommand(projectCommand());
  program.addCommand(statusCommand());
  program.addCommand(taskCommand());
  program.addCommand(todayCommand());
  program.addCommand(tagCommand());
  program.addCommand(fieldCommand());
  program.addCommand(relationCommand());
  program.addCommand(workspaceCommand());
  program.addCommand(searchCommand());
  program.addCommand(viewCommand());
  program.addCommand(notificationsCommand());
  program.addCommand(exportCommand());
  program.addCommand(importCommand());
  program.addCommand(webhookCommand());
  program.addCommand(usageCommand());

  return program;
}
