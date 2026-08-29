import { ApiClient, ApiClientError } from "@morrowlist/api-client";
import { Command } from "commander";

import {
  DEFAULT_BASE_URL,
  configPath,
  readConfig,
  redactKey,
  resolveProfile,
  writeConfig,
  type ResolveOptions,
} from "../config/profile.js";
import { EXIT, exitCodeFor, printError, printJson } from "../formatters/output.js";

/**
 * `morrow auth …` (AUTH-007).
 *
 * The CLI never asks for a password: it authenticates with a workspace-scoped API key
 * created in the web app, so a compromised shell history cannot yield an account.
 */
/** See the note in commands/task.ts: Commander types `parent` loosely. */
function globalsOf<T>(command: Command): T {
  return ((command.parent?.parent ?? command.parent)?.opts() ?? {}) as T;
}

/** Read a credential from stdin, tolerating a trailing newline. */
async function readKeyFromStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  const value = Buffer.concat(chunks).toString("utf8").trim();
  return value.length > 0 ? value : undefined;
}

export function authCommand(): Command {
  const auth = new Command("auth").description("Configure credentials and profiles");

  auth
    .command("login")
    .description("Store an API key for a profile. The key is read from stdin.")
    // --base-url, --workspace, and --profile are the root command's global flags rather
    // than being redeclared here. Declaring them twice makes the root definition win
    // wherever they appear, which silently discards the subcommand's value.
    .addHelpText(
      "after",
      "\nThe key is read from stdin so it never appears in argv or shell history:\n" +
        "  pbpaste | morrow --base-url https://morrow.example.com/api/v1 auth login\n",
    )
    .action(async (_options, command: Command) => {
      const globals = globalsOf<ResolveOptions>(command);
      const config = await readConfig();
      const name = globals.profile ?? config.defaultProfile;
      const existing = config.profiles[name];

      // A key passed as `--api-key` would be visible to any process that can read the
      // process table, so the stored key comes from stdin.
      const apiKey = globals.apiKey ?? (await readKeyFromStdin());
      if (!apiKey) {
        printError(
          "error: no API key supplied. Pipe it in, for example:\n" +
            "  pbpaste | morrow auth login",
        );
        process.exit(EXIT.usage);
      }

      const workspaceId = globals.workspaceId ?? existing?.workspaceId;
      await writeConfig({
        defaultProfile: config.defaultProfile,
        profiles: {
          ...config.profiles,
          [name]: {
            baseUrl: globals.baseUrl ?? existing?.baseUrl ?? DEFAULT_BASE_URL,
            apiKey,
            ...(workspaceId ? { workspaceId } : {}),
          },
        },
      });

      process.stdout.write(
        `Saved profile "${name}" to ${configPath()} with owner-only permissions.\n`,
      );
    });

  auth
    .command("status")
    .description("Show the effective profile and verify the credential")
    .action(async (_options, command: Command) => {
      const globals = globalsOf<ResolveOptions & { json?: boolean }>(command);
      const json = Boolean(globals.json);
      const config = await readConfig();
      const profile = resolveProfile(config, globals);

      try {
        const client = new ApiClient({
          baseUrl: profile.baseUrl,
          apiKey: profile.apiKey,
          workspaceId: profile.workspaceId,
        });
        const me = await client.me();

        if (json) {
          printJson({
            ok: true,
            data: {
              profile: profile.name,
              baseUrl: profile.baseUrl,
              apiKey: redactKey(profile.apiKey),
              user: me.user,
              workspaces: me.workspaces,
            },
          });
        } else {
          process.stdout.write(
            [
              `profile    ${profile.name}`,
              `base url   ${profile.baseUrl}`,
              `api key    ${redactKey(profile.apiKey)}`,
              `signed in  ${me.user.email}`,
              `workspaces ${me.workspaces.map((w) => `${w.taskKeyPrefix} (${w.name})`).join(", ")}`,
            ].join("\n") + "\n",
          );
        }
      } catch (error) {
        if (error instanceof ApiClientError) {
          if (json) {
            printJson({
              ok: false,
              error: { code: error.code, message: error.message },
            });
          } else {
            printError(`profile    ${profile.name}`);
            printError(`base url   ${profile.baseUrl}`);
            printError(`api key    ${redactKey(profile.apiKey)}`);
            printError(`error      ${error.message}`);
          }
          process.exit(exitCodeFor(error.code));
        }
        printError(
          `error: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(EXIT.network);
      }
    });

  auth
    .command("logout")
    .description("Remove the stored API key for a profile")
    .action(async (_options, command: Command) => {
      const globals = globalsOf<ResolveOptions>(command);
      const config = await readConfig();
      const name = globals.profile ?? config.defaultProfile;
      const existing = config.profiles[name];

      if (!existing) {
        process.stdout.write(`No profile named "${name}".\n`);
        return;
      }

      const { apiKey: _removed, ...rest } = existing;
      await writeConfig({
        defaultProfile: config.defaultProfile,
        profiles: { ...config.profiles, [name]: rest },
      });
      process.stdout.write(`Removed the API key from profile "${name}".\n`);
    });

  return auth;
}
