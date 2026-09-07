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
export function capturePath(shared: SharedCapture): string {
  const query = new URLSearchParams();
  if (shared.title) query.set("title", shared.title);
  if (shared.text) query.set("text", shared.text);
  if (shared.url) query.set("url", shared.url);
  return `/capture?${query}`;
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
