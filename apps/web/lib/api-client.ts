"use client";

import { ApiClient } from "@morrowlist/api-client";

/** A write attempted while the browser is offline (spec 25.1, ADR-008). */
export class OfflineError extends Error {
  constructor() {
    super(
      "You're offline. This change was not sent; try again when you're back online.",
    );
    this.name = "OfflineError";
  }
}

/**
 * Reads still go out so the service worker can answer them from its cache; a write is
 * refused before it leaves the page, so nothing is queued and nothing is reported as
 * saved that the server never received.
 */
function guardedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET" && !navigator.onLine) return Promise.reject(new OfflineError());
  return fetch(input, init);
}

/**
 * Browser client. The session cookie authenticates, so no key is configured here; the
 * same class serves the CLI with a bearer key (spec 16.2).
 */
export const apiClient = new ApiClient({
  baseUrl: "/api/v1",
  fetch: guardedFetch,
});
