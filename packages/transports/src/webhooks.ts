import { webhookHeaders, type WebhookSender } from "@morrowlist/application";

import { HTTP_TIMEOUT_MS, post, type HttpTransportOptions } from "./http.js";

export const WEBHOOK_TIMEOUT_MS = HTTP_TIMEOUT_MS;

export function createFetchWebhookSender(
  options: HttpTransportOptions = {},
): WebhookSender {
  return {
    async send(request) {
      try {
        const response = await post(
          request.url,
          {
            headers: webhookHeaders(request),
            body: request.body,
          },
          options,
        );
        return {
          status: response.status,
          error: response.ok ? null : `endpoint responded ${response.status}`,
        };
      } catch (error) {
        return {
          status: null,
          error: describeTransportFailure(error, options.timeoutMs),
        };
      }
    },
  };
}

/**
 * Node's fetch reports every transport failure as the word "fetch failed" and hides the
 * reason in `cause`. Unwrapping it is the difference between a delivery log that says
 * nothing and one that says the endpoint refused the connection.
 */
export function describeTransportFailure(
  error: unknown,
  timeoutMs = WEBHOOK_TIMEOUT_MS,
): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  const detail = cause instanceof Error ? cause.message : null;
  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return `no response within ${timeoutMs / 1000} seconds`;
  }
  return detail && detail !== error.message
    ? `${error.message}: ${detail}`
    : error.message;
}
