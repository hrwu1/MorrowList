import { randomUUID } from "node:crypto";

import { ApiClient, ApiClientError } from "@morrowlist/api-client";
import type { Command } from "commander";

import { readConfig, resolveProfile, type ResolveOptions } from "../config/profile.js";
import { EXIT, exitCodeFor, printError, printJson } from "../formatters/output.js";

/** Plumbing shared by the resource commands: profile resolution, output, and exit codes. */

export interface GlobalOptions extends ResolveOptions {
  readonly json?: boolean;
}

/**
 * Global flags live on the root command, two levels above a subcommand action. Commander
 * types `parent` loosely, so the cast is confined to this one helper.
 */
export function globalsOf(command: Command): GlobalOptions {
  return ((command.parent?.parent ?? command.parent)?.opts() ?? {}) as GlobalOptions;
}

export async function withClient<T>(
  options: GlobalOptions,
  fn: (client: ApiClient) => Promise<T>,
): Promise<T> {
  const config = await readConfig();
  const profile = resolveProfile(config, options);
  const client = new ApiClient({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    workspaceId: profile.workspaceId,
  });
  return fn(client);
}

/** Every mutating command carries an idempotency key so a retry cannot duplicate it. */
export function idempotency() {
  return { idempotencyKey: randomUUID() };
}

export function fail(error: unknown, json: boolean): never {
  if (error instanceof ApiClientError) {
    if (json) {
      printJson({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    } else {
      printError(`error: ${error.message}`);
      if (error.code === "TASK_VERSION_CONFLICT") {
        printError("The task changed since you loaded it. Re-read it and try again.");
      }
      if (error.requestId) printError(`request: ${error.requestId}`);
    }
    process.exit(exitCodeFor(error.code));
  }

  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    printJson({ ok: false, error: { code: "NETWORK_ERROR", message } });
  } else {
    printError(`error: ${message}`);
  }
  process.exit(EXIT.network);
}

/** A usage-level failure the API was never asked about, such as an unknown tag name. */
export function usageFailure(message: string, json: boolean): never {
  if (json) printJson({ ok: false, error: { code: "USAGE", message } });
  else printError(`error: ${message}`);
  process.exit(EXIT.usage);
}
