import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  DEFAULT_API_BASE_URL as DEFAULT_BASE_URL,
  resolveClientEnvironment,
} from "@morrowlist/api-client";

/**
 * CLI configuration and profiles (AUTH-007, spec 21.2).
 *
 * Precedence, highest first: command flags, environment variables, the named profile in
 * the config file, then the default profile. This lets a script override a stored profile
 * without editing any file.
 *
 * The config file holds an API key, so it is written with owner-only permissions and its
 * contents are never echoed in full.
 */

export interface Profile {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly workspaceId?: string;
}

export interface ConfigFile {
  readonly defaultProfile: string;
  readonly profiles: Record<string, Profile>;
}

export { DEFAULT_BASE_URL };

export function configPath(): string {
  const override = process.env.MORROW_CONFIG;
  if (override) return override;
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "morrowlist", "config.json");
}

export async function readConfig(): Promise<ConfigFile> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<ConfigFile>;
    return {
      defaultProfile: parsed.defaultProfile ?? "default",
      profiles: parsed.profiles ?? {},
    };
  } catch {
    // A missing or unreadable config is not an error: environment variables alone are a
    // supported way to run the CLI, which is what CI usually does.
    return { defaultProfile: "default", profiles: {} };
  }
}

export async function writeConfig(config: ConfigFile): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // Re-assert the mode: an existing file keeps its original permissions on write.
  await chmod(path, 0o600);
}

export interface ResolveOptions {
  readonly profile?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly workspaceId?: string;
}

export interface ResolvedProfile extends Profile {
  readonly name: string;
}

/** Merge flags, environment, and file config into the effective profile. */
export function resolveProfile(
  config: ConfigFile,
  options: ResolveOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedProfile {
  const name = options.profile ?? env.MORROW_PROFILE ?? config.defaultProfile;
  const stored = config.profiles[name] ?? { baseUrl: DEFAULT_BASE_URL };

  const connection = resolveClientEnvironment(env, stored);
  const apiKey = options.apiKey ?? connection.apiKey;
  const workspaceId = options.workspaceId ?? connection.workspaceId;

  return {
    name,
    baseUrl: options.baseUrl ?? connection.baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

/** Never print a key in full; enough to identify it, not enough to use it. */
export function redactKey(apiKey: string | undefined): string {
  if (!apiKey) return "(not set)";
  return apiKey.length <= 8 ? "****" : `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}
