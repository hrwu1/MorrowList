import type { ApiClientOptions } from "./client.js";

/** Connection defaults shared by command-line adapters; no process environment is read here. */
export const DEFAULT_API_BASE_URL = "http://localhost:3200/api/v1";

type ConnectionOptions = Pick<ApiClientOptions, "baseUrl" | "apiKey" | "workspaceId">;

/** Environment overrides supplied defaults, such as a selected CLI profile. */
export function resolveClientEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  defaults: Partial<ConnectionOptions> = {},
): ConnectionOptions {
  return {
    baseUrl: env.MORROW_BASE_URL ?? defaults.baseUrl ?? DEFAULT_API_BASE_URL,
    apiKey: env.MORROW_API_KEY ?? defaults.apiKey,
    // Preserve older MCP configuration while standardizing on the CLI variable.
    workspaceId:
      env.MORROW_WORKSPACE_ID ?? env.MORROW_WORKSPACE ?? defaults.workspaceId,
  };
}
