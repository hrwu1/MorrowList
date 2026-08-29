import { getContainer } from "@/lib/server";

/**
 * Mounts the Hono API inside Next.js (ADR-003). Hono speaks the Fetch API, so each Next
 * route handler forwards the request unchanged and the same app could later be served by
 * a standalone Node process without modification.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handler(request: Request): Response | Promise<Response> {
  return getContainer().api.fetch(request);
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
