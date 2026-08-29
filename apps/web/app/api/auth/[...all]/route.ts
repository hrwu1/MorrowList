import { getContainer } from "@/lib/server";

/** Better Auth endpoints (spec 20.1). Handled by the provider behind the auth adapter. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handler(request: Request): Promise<Response> {
  return getContainer().handleAuthRequest(request);
}

export const GET = handler;
export const POST = handler;
