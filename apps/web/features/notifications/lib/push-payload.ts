/**
 * What the service worker makes of a delivered push (GAP-13 step 7).
 *
 * It lives beside the page's push code rather than inside `sw/sw.ts` so it can be tested
 * without a browser: headless Chromium has no notification platform, so the worker's
 * `push` handler cannot be exercised end to end, and this is the part of it worth
 * proving. `sw.ts` imports these two functions the way it already imports the cache
 * policy — nothing here touches a browser API.
 */

export interface PushNotification {
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly tag: string;
}

/**
 * A browser that has granted permission shows its own "this site was updated in the
 * background" notice if the worker shows nothing, so an unreadable payload still becomes
 * a notification rather than nothing.
 */
export const FALLBACK_NOTIFICATION: PushNotification = {
  title: "MorrowList",
  body: "You have a new notification.",
  url: "/notifications",
  tag: "morrowlist",
};

/** The notification a payload describes, falling back member by member. */
export function readPushNotification(raw: unknown): PushNotification {
  if (!raw || typeof raw !== "object") return FALLBACK_NOTIFICATION;
  const parsed = raw as Partial<Record<keyof PushNotification, unknown>>;
  const read = (key: keyof PushNotification): string =>
    typeof parsed[key] === "string" && parsed[key].length > 0
      ? parsed[key]
      : FALLBACK_NOTIFICATION[key];
  return {
    title: read("title"),
    body: read("body"),
    url: read("url"),
    tag: read("tag"),
  };
}

/**
 * Where a click should land, resolved against the worker's own scope. A payload is server
 * data, but it arrives through a third-party push service, so a URL pointing anywhere but
 * this origin is refused rather than followed.
 */
export function notificationTarget(url: string, scope: string): string {
  const base = new URL(scope);
  try {
    const target = new URL(url, base);
    if (target.origin !== base.origin) return new URL("/today", base).href;
    return target.href;
  } catch {
    return new URL("/today", base).href;
  }
}
