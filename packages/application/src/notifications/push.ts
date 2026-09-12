import type { PushSubscription } from "../ports/index.js";

/**
 * Outbound web push port (GAP-13 step 7, spec 31.3).
 *
 * The shape mirrors `EmailSender` deliberately: the application composes the message, an
 * adapter delivers it, and delivery happens after the transaction that decided to notify
 * has committed. A slow or failing push service therefore never holds a database lock and
 * can never roll back the in-app row the user has already been shown.
 *
 * The one thing push needs that email does not is a way to say "this device is gone", so
 * a registration a browser has thrown away does not sit in the table forever.
 */

export interface PushMessage {
  readonly subscription: PushSubscription;
  readonly title: string;
  readonly body: string;
  /** Where clicking the notification takes the user; an absolute URL. */
  readonly url: string;
  /**
   * Collapse key. Two notifications with the same tag replace one another on the device,
   * so a snoozed reminder does not stack up behind the one it replaces.
   */
  readonly tag: string;
}

export type PushResult =
  | { readonly ok: true }
  /**
   * The push service says this endpoint no longer exists (404 or 410). The caller deletes
   * the subscription; every other failure is transient and keeps it.
   */
  | { readonly ok: false; readonly gone: true; readonly error: string }
  | { readonly ok: false; readonly gone?: false; readonly error: string };

export interface PushSender {
  send(message: PushMessage): Promise<PushResult>;
}

/** Test double that records what would have been sent. */
export function createRecordingPushSender(
  results: ReadonlyMap<string, PushResult> = new Map(),
): PushSender & { readonly sent: PushMessage[] } {
  const sent: PushMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return results.get(message.subscription.endpoint) ?? { ok: true };
    },
  };
}

/** A push endpoint's origin, which is the most that may reach a log. */
export function endpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return "unknown";
  }
}
