import { ApiClient } from "@morrowlist/api-client";

import {
  capturePath,
  CAPTURE_REDIRECT_TOO_LONG,
  type SharedCapture,
  readSharedCapture,
  sharedTaskRequest,
} from "@/features/capture/lib/share";
import { getContainer } from "@/lib/server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  // Bound streaming input too; Content-Length alone is not trustworthy.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader)
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 32_768) {
        await reader.cancel();
        return new Response("Share is too large.", { status: 413 });
      }
      chunks.push(value);
    }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let shared;
  try {
    const form = await new Response(bytes, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    shared = readSharedCapture(form);
  } catch {
    return new Response("Invalid shared title, text or URL.", { status: 422 });
  }
  const container = getContainer();
  const origin = new URL(container.env.APP_URL).origin;
  const preview = () => previewResponse(shared, origin);
  const user = await container.auth.resolveUser(request.headers);
  const source = request.headers.get("origin");
  // A cross-site HTML form may preview, but cannot silently create a task.
  if (!user || (source && source !== origin)) return preview();
  const client = new ApiClient({
    baseUrl: `${origin}/api/v1`,
    fetch: async (input, init) => {
      const forwarded = new Headers(init?.headers);
      const cookie = request.headers.get("cookie");
      if (cookie) forwarded.set("cookie", cookie);
      return container.api.fetch(new Request(input, { ...init, headers: forwarded }));
    },
  });
  try {
    const task = await client.createTask(sharedTaskRequest(shared));
    return Response.redirect(new URL(`/tasks/${task.key}`, origin), 303);
  } catch {
    // Failed captures stay reviewable and retryable; never discard the shared text.
    return preview();
  }
}

function previewResponse(shared: SharedCapture, origin: string): Response {
  try {
    return Response.redirect(new URL(capturePath(shared), origin), 303);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    // Keep the original content copyable without putting an oversized draft in a URL.
    return new Response(
      [
        CAPTURE_REDIRECT_TOO_LONG,
        ...[shared.title, shared.text, shared.url].filter(Boolean),
      ].join("\n\n"),
      {
        status: 413,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
}
