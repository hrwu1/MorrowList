/**
 * The browser's side of web push (GAP-13 step 7).
 *
 * Everything that can be decided without touching the browser lives here as a pure
 * function, so the states the settings page can be in are testable; the two functions
 * that do talk to the browser are thin wrappers around the Push API.
 */

/** Why push cannot be offered, or `null` when it can. */
export type PushBlocker =
  /** The deployment has no VAPID keys, so nothing could be sent. */
  | "unconfigured"
  /** This browser has no Push API — Safari before 16.4, or a private window. */
  | "unsupported"
  /** The user refused permission; only they can undo that, in browser settings. */
  | "denied";

export interface PushState {
  readonly blocker: PushBlocker | null;
  /** Is a device registered for this browser right now? */
  readonly subscribed: boolean;
  /** What the settings page shows beside the checkbox. */
  readonly hint: string;
}

export interface PushInputs {
  readonly configured: boolean;
  readonly supported: boolean;
  readonly permission: NotificationPermission | null;
  readonly subscribed: boolean;
}

/**
 * The one place that decides whether the push control is usable. Order matters: an
 * unconfigured deployment is reported as such even in a browser that could not do it
 * anyway, because that is the one an administrator can fix.
 */
export function pushState(inputs: PushInputs): PushState {
  if (!inputs.configured) {
    return {
      blocker: "unconfigured",
      subscribed: false,
      hint: "This server has no push keys configured, so nothing can be sent.",
    };
  }
  if (!inputs.supported) {
    return {
      blocker: "unsupported",
      subscribed: false,
      hint: "This browser cannot receive push notifications.",
    };
  }
  if (inputs.permission === "denied") {
    return {
      blocker: "denied",
      subscribed: inputs.subscribed,
      hint: "Notifications are blocked for this site; allow them in your browser settings.",
    };
  }
  return {
    blocker: null,
    subscribed: inputs.subscribed,
    hint: inputs.subscribed
      ? "This device is registered."
      : "You will be asked for permission when you turn this on.",
  };
}

/** Does this browser have everything push needs? */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * The VAPID public key as the `applicationServerKey` the Push API wants: raw bytes, not
 * the base64url string the server publishes.
 */
export function applicationServerKey(publicKey: string): Uint8Array<ArrayBuffer> {
  const padded = publicKey.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** The registration this browser already has, or null. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/**
 * Ask for permission and register this device. Returns the subscription's JSON — the
 * shape `POST /me/push-subscriptions` takes — or null when the user said no.
 */
export async function subscribeToPush(publicKey: string): Promise<{
  endpoint: string;
  keys: { p256dh: string; auth: string };
} | null> {
  if (!pushSupported()) return null;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  const registration = await navigator.serviceWorker.ready;
  // An existing registration made with a different key can never be delivered to, so it
  // is replaced rather than reused.
  const existing = await registration.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });
  return toRequest(subscription);
}

/** Drop this browser's registration; returns the endpoint that was removed, if any. */
export async function unsubscribeFromPush(): Promise<string | null> {
  const subscription = await currentSubscription();
  if (!subscription) return null;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}

function toRequest(subscription: PushSubscription): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const json = subscription.toJSON();
  const keys = json.keys ?? {};
  if (!keys.p256dh || !keys.auth) {
    throw new Error("The browser returned a subscription without its keys.");
  }
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}
