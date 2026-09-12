export const HTTP_TIMEOUT_MS = 10_000;
export interface HttpTransportOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

/** Both outbound HTTP adapters refuse redirects and bound each network attempt. */
export function post(
  url: string,
  init: RequestInit,
  options: HttpTransportOptions,
): Promise<Response> {
  return (options.fetch ?? globalThis.fetch)(url, {
    ...init,
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs ?? HTTP_TIMEOUT_MS),
  });
}
