"use client";

import { ApiClient } from "@morrowlist/api-client";

/**
 * Browser client. The session cookie authenticates, so no key is configured here; the
 * same class serves the CLI with a bearer key (spec 16.2).
 */
export const apiClient = new ApiClient({
  baseUrl: "/api/v1",
});
