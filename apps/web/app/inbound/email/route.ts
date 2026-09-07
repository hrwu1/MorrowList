import { getContainer } from "@/lib/server";
export const runtime = "nodejs";
/** Provider-friendly alias; the API retains authentication and the bounded-body policy. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  url.pathname = "/api/v1/inbound/email";
  return getContainer().api.fetch(new Request(url, request));
}
