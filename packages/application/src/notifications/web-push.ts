import {
  createECDH,
  createPrivateKey,
  createSign,
  hkdfSync,
  randomBytes,
  createCipheriv,
} from "node:crypto";

import type { Logger } from "@morrowlist/observability";

import type { PushSubscription } from "../ports/index.js";

import {
  endpointOrigin,
  type PushMessage,
  type PushResult,
  type PushSender,
} from "./push.js";

/**
 * Real Web Push delivery (GAP-13 step 7).
 *
 * Two standards meet here and nothing else in the codebase needs either, so both are
 * implemented against `node:crypto` rather than pulled in as a dependency — this package
 * has no third-party runtime dependency and already signs webhook deliveries the same way.
 *
 * - RFC 8291 encrypts the payload to the browser's own key pair, so the push service that
 *   relays it cannot read the task's title. One record, `aes128gcm` (RFC 8188).
 * - RFC 8292 authenticates *us* to the push service with a short-lived ES256 JWT, so a
 *   third party cannot post to an endpoint they happened to learn.
 *
 * The subscription's `p256dh` and `auth` are device credentials: they are used here and
 * never logged, echoed, or recorded in an event payload (spec 27.1).
 */

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url; also what the browser subscribes with. */
  readonly publicKey: string;
  /** P-256 private scalar, base64url. */
  readonly privateKey: string;
  /** `mailto:` or `https:` contact the push service can reach (RFC 8292 §2.1). */
  readonly subject: string;
}

export interface WebPushSenderOptions {
  readonly keys: VapidKeys;
  readonly logger?: Logger;
  /** How long the push service should hold an undelivered message. */
  readonly ttlSeconds?: number;
}

/** Give up on an unresponsive push service rather than holding the delivery loop open. */
export const PUSH_TIMEOUT_MS = 10_000;

/** A reminder is worth nothing tomorrow; four hours is long enough for a closed laptop. */
export const DEFAULT_PUSH_TTL_SECONDS = 4 * 60 * 60;

/** The VAPID JWT's life. RFC 8292 caps it at 24 hours; half that is plenty. */
const JWT_LIFETIME_SECONDS = 12 * 60 * 60;

export function createWebPushSender(options: WebPushSenderOptions): PushSender {
  const ttl = options.ttlSeconds ?? DEFAULT_PUSH_TTL_SECONDS;

  return {
    async send(message: PushMessage): Promise<PushResult> {
      let body: Buffer;
      let authorization: string;
      try {
        body = encryptPushPayload(message.subscription, pushPayload(message));
        authorization = vapidAuthorization(
          endpointOrigin(message.subscription.endpoint),
          options.keys,
        );
      } catch (error) {
        // A subscription whose keys cannot be read will never work again; treating it as
        // gone stops it being retried on every reminder forever.
        return { ok: false, gone: true, error: reason(error) };
      }

      try {
        const response = await fetch(message.subscription.endpoint, {
          method: "POST",
          headers: {
            authorization,
            "content-encoding": "aes128gcm",
            "content-type": "application/octet-stream",
            ttl: String(ttl),
            urgency: "normal",
          },
          body: new Uint8Array(body),
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
        });
        if (response.ok) return { ok: true };
        // 404 and 410 are the two the standard defines as "this endpoint is finished".
        if (response.status === 404 || response.status === 410) {
          return {
            ok: false,
            gone: true,
            error: `push endpoint gone (${response.status})`,
          };
        }
        return { ok: false, error: `push service answered ${response.status}` };
      } catch (error) {
        return { ok: false, error: reason(error) };
      }
    },
  };
}

/** What the service worker's `push` handler reads. */
export function pushPayload(message: PushMessage): string {
  return JSON.stringify({
    title: message.title,
    body: message.body,
    url: message.url,
    tag: message.tag,
  });
}

/* --------------------------------------------------------------- RFC 8291 */

const KEY_INFO_PREFIX = "WebPush: info\0";
const CEK_INFO = "Content-Encoding: aes128gcm\0";
const NONCE_INFO = "Content-Encoding: nonce\0";
const SALT_LENGTH = 16;
const KEY_LENGTH = 16;
const NONCE_LENGTH = 12;
/** One record holds the whole payload; nothing sent here is anywhere near this big. */
const RECORD_SIZE = 4096;

/**
 * The subscription's keys and one ephemeral key pair produce a content key only that
 * browser can derive. Exported for the test that decrypts what this produced.
 */
export function encryptPushPayload(
  subscription: Pick<PushSubscription, "keys">,
  payload: string,
  salt: Buffer = randomBytes(SALT_LENGTH),
): Buffer {
  const userPublicKey = decodeBase64Url(subscription.keys.p256dh);
  const authSecret = decodeBase64Url(subscription.keys.auth);
  if (userPublicKey.length !== 65 || userPublicKey[0] !== 4) {
    throw new Error("subscription key is not an uncompressed P-256 point");
  }

  const ecdh = createECDH("prime256v1");
  const serverPublicKey = ecdh.generateKeys();
  const sharedSecret = ecdh.computeSecret(userPublicKey);

  // The user agent's key comes first in `key_info`: both sides must agree on the order,
  // and the recipient is named before the sender (RFC 8291 §3.4).
  const keyInfo = Buffer.concat([
    Buffer.from(KEY_INFO_PREFIX, "utf8"),
    userPublicKey,
    serverPublicKey,
  ]);
  const ikm = Buffer.from(hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32));
  const contentKey = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from(CEK_INFO, "utf8"), KEY_LENGTH),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from(NONCE_INFO, "utf8"), NONCE_LENGTH),
  );

  // 0x02 is the delimiter of the *last* record; there is only one.
  const record = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([0x02])]);
  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(record),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(SALT_LENGTH + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, SALT_LENGTH);
  header.writeUInt8(serverPublicKey.length, SALT_LENGTH + 4);

  return Buffer.concat([header, serverPublicKey, ciphertext]);
}

/* --------------------------------------------------------------- RFC 8292 */

/** `vapid t=<jwt>, k=<public key>`: who we are, and for which push origin. */
export function vapidAuthorization(audience: string, keys: VapidKeys): string {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(
    Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  );
  const claims = encodeBase64Url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: now + JWT_LIFETIME_SECONDS,
        sub: keys.subject,
      }),
    ),
  );

  const signingInput = `${header}.${claims}`;
  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({ key: vapidPrivateKey(keys), dsaEncoding: "ieee-p1363" });

  return `vapid t=${signingInput}.${encodeBase64Url(signature)}, k=${keys.publicKey}`;
}

/**
 * The raw scalar and point a VAPID key pair is distributed as, as a key object. JWK is
 * the one import format that takes the coordinates directly, without hand-built DER.
 */
function vapidPrivateKey(keys: VapidKeys) {
  const point = decodeBase64Url(keys.publicKey);
  if (point.length !== 65 || point[0] !== 4) {
    throw new Error("VAPID public key is not an uncompressed P-256 point");
  }
  return createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      x: encodeBase64Url(point.subarray(1, 33)),
      y: encodeBase64Url(point.subarray(33, 65)),
      d: keys.privateKey,
    },
  });
}

/* ------------------------------------------------------------------ shared */

export function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function encodeBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
