import type { CreateTaskRequest } from "@morrowlist/contracts";

export interface SharedCapture {
  title: string;
  text: string;
  url: string;
}
export function readSharedCapture(input: {
  get(name: string): unknown;
}): SharedCapture {
  const field = (name: string, max: number): string => {
    const value = input.get(name) ?? "";
    if (typeof value !== "string" || value.length > max)
      throw new Error(`Shared ${name} is too long or is not text.`);
    return value.trim();
  };
  const result = {
    title: field("title", 500),
    text: field("text", 8000),
    url: field("url", 2000),
  };
  if (result.url && !/^https?:\/\//i.test(result.url))
    throw new Error("Shared URLs must use http or https.");
  return result;
}
export function sharedTaskRequest(shared: SharedCapture): CreateTaskRequest {
  const fallback = shared.text.split("\n")[0] || shared.url || "Shared item";
  return {
    title: shared.title || [...fallback].slice(0, 500).join(""),
    descriptionMd: [shared.text, shared.url].filter(Boolean).join("\n\n") || null,
  };
}
/** Leave room for cookies and other headers below common HTTP request limits. */
export const MAX_CAPTURE_LOGIN_PATH_LENGTH = 6000;
export const CAPTURE_REDIRECT_TOO_LONG =
  "This share is too long to preserve through sign-in. Copy the shared content below into a new task, or go back and share a shorter selection.";

export function capturePath(shared: SharedCapture): string {
  const query = new URLSearchParams();
  if (shared.title) query.set("title", shared.title);
  if (shared.text) query.set("text", shared.text);
  if (shared.url) query.set("url", shared.url);
  const path = `/capture?${query}`;
  if (
    `/sign-in?returnTo=${encodeURIComponent(path)}`.length >
    MAX_CAPTURE_LOGIN_PATH_LENGTH
  )
    throw new RangeError(CAPTURE_REDIRECT_TOO_LONG);
  return path;
}
/** Login return targets are restricted to the local capture page. */
export function captureReturnTo(value: unknown): string {
  return typeof value === "string" &&
    (value === "/capture" || value.startsWith("/capture?")) &&
    !/[\r\n\\]/.test(value)
    ? value
    : "/inbox";
}
export function captureBookmarklet(origin: string): string {
  return `javascript:(()=>{window.open(${JSON.stringify(origin + "/capture")}+'?title='+encodeURIComponent(document.title)+'&url='+encodeURIComponent(location.href),'morrowlist-capture','popup,width=560,height=600')})()`;
}
