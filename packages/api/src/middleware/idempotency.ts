import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { IdempotencyService } from "@morrowlist/application";
import type { MiddlewareHandler } from "hono";

import type { ApiEnv } from "../context.js";
import { ApiError } from "../errors.js";
import { requireWorkspace } from "../routes/workspace.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** A non-success response must escape the transaction, including Hono-mapped errors. */
class UncommittedResponse extends Error {
  constructor(readonly response: Response) {
    super("The command did not succeed.");
  }
}

/**
 * Protect every authenticated mutation through one policy. Provider-authenticated inbound
 * email keeps its own receipt-based deduplication; auth-provider routes live outside this API.
 * Response encryption keeps one-time webhook secrets and capability URLs out of storage.
 */
export function idempotency(
  service: IdempotencyService,
  secret: string,
): MiddlewareHandler<ApiEnv> {
  const encryptionKey = createHash("sha256")
    .update(`morrowlist-replay:${secret}`)
    .digest();

  function seal(value: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [nonce, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString("base64url"))
      .join(".");
  }

  function open(value: string): string {
    const parts = value.split(".").map((part) => Buffer.from(part, "base64url"));
    const [nonce, tag, encrypted] = parts;
    if (!nonce || !tag || !encrypted) throw new Error("Invalid replay envelope");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
      "utf8",
    );
  }

  return async (c, next) => {
    const actor = c.get("actor");
    const key = c.req.header("idempotency-key");
    if (!actor || !key || !["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method)) {
      await next();
      return;
    }
    if (key.length > 200 || !key.trim()) {
      throw new ApiError(
        "VALIDATION_FAILED",
        "Idempotency-Key must contain 1 to 200 characters.",
      );
    }
    const url = new URL(c.req.url);
    const workspacePath = url.pathname.match(/\/workspaces\/([^/]+)$/)?.[1];
    const workspaceId = requireWorkspace(
      workspacePath ?? url.searchParams.get("workspaceId") ?? undefined,
      actor.workspaceIds,
    );
    url.searchParams.sort();
    const body = await c.req.raw.clone().text();
    const scopeHash = digest(
      JSON.stringify([
        actor.actorKind,
        actor.actorId,
        workspaceId,
        c.req.method,
        url.pathname,
      ]),
    );
    const fingerprint = digest(
      JSON.stringify([url.search, c.req.header("content-type") ?? "", body]),
    );
    try {
      const result = await service.execute(
        actor,
        {
          workspaceId,
          scopeHash,
          keyHash: digest(key),
          fingerprint,
        },
        async () => {
          await next();
          if (c.res.status < 200 || c.res.status >= 300)
            throw new UncommittedResponse(c.res);
          // Request identity belongs to the current request, not the replayed response.
          const headers = [...c.res.headers].filter(
            ([name]) => !["set-cookie", "x-request-id"].includes(name),
          );
          return seal(
            JSON.stringify({
              status: c.res.status,
              headers,
              body: await c.res.clone().text(),
            }),
          );
        },
      );
      const response = JSON.parse(open(result)) as {
        status: number;
        headers: [string, string][];
        body: string;
      };
      const headers = new Headers(response.headers);
      headers.set("x-request-id", c.get("requestId"));
      c.res = new Response(response.status === 204 ? null : response.body, {
        status: response.status,
        headers,
      });
    } catch (error) {
      if (error instanceof UncommittedResponse) {
        c.res = error.response;
        return;
      }
      throw error;
    }
  };
}
