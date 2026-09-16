import type { NextRequest } from "next/server";

import { getContainer } from "@/lib/server";

/**
 * CalDAV lives here, not in a route handler: Next routes only the seven common HTTP
 * methods, and Calendar.app speaks PROPFIND and REPORT (GAP-25). Node-runtime middleware
 * sees every method, so it hands `/dav/*` and the well-known discovery path to the Hono
 * DAV app and returns its response as-is. Nothing else passes through here.
 */
export const config = {
  matcher: ["/dav/:path*", "/.well-known/caldav"],
  runtime: "nodejs",
};

export function middleware(request: NextRequest): Promise<Response> | Response {
  return getContainer().dav.fetch(request);
}
