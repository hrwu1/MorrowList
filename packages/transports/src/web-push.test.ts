import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  createVerify,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createWebPushSender,
  decodeBase64Url,
  encodeBase64Url,
  encryptPushPayload,
  vapidAuthorization,
  type VapidKeys,
} from "./web-push.js";

/**
 * The point of this suite is that the bytes are right, not that the code ran: every test
 * plays the browser's part with the subscription's own private key. If the key
 * derivation, the record framing or the JWT were wrong, the decryption or the signature
 * check below would fail — a mocked `fetch` alone would prove nothing.
 */

/** A browser's subscription: its key pair, its auth secret, and the public halves. */
function browserSubscription(endpoint = "https://push.example/device-1") {
  const ecdh = createECDH("prime256v1");
  const publicKey = ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    endpoint,
    privateKey: ecdh,
    authSecret,
    subscription: {
      userId: "01a04e0f-0000-7000-8000-000000000001",
      endpoint,
      keys: {
        p256dh: encodeBase64Url(publicKey),
        auth: encodeBase64Url(authSecret),
      },
      createdAt: new Date("2026-09-09T09:00:00.000Z"),
    },
    publicKey,
  };
}

/** RFC 8291 §3.4 in reverse, as a user agent performs it. */
function decrypt(body: Buffer, device: ReturnType<typeof browserSubscription>): string {
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const serverPublicKey = body.subarray(21, 21 + keyLength);
  const ciphertext = body.subarray(21 + keyLength);

  const sharedSecret = device.privateKey.computeSecret(serverPublicKey);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    device.publicKey,
    serverPublicKey,
  ]);
  const ikm = Buffer.from(
    hkdfSync("sha256", sharedSecret, device.authSecret, keyInfo, 32),
  );
  const contentKey = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", contentKey, nonce);
  decipher.setAuthTag(tag);
  const record = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);

  // The last record ends with 0x02; anything else means the framing is wrong.
  expect(record.at(-1)).toBe(0x02);
  return record.subarray(0, record.length - 1).toString("utf8");
}

/** A VAPID pair in the raw base64url form the browser and the config both use. */
function vapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  const publicKey = ecdh.generateKeys();
  return {
    publicKey: encodeBase64Url(publicKey),
    privateKey: encodeBase64Url(ecdh.getPrivateKey()),
    subject: "mailto:ops@morrow.example",
  };
}

describe("encryptPushPayload", () => {
  it("produces a body the subscribed browser can decrypt", () => {
    const device = browserSubscription();
    const payload = JSON.stringify({
      title: "Reminder: Draft the brief",
      body: "ML-1",
    });

    const body = encryptPushPayload(device.subscription, payload);

    expect(decrypt(body, device)).toBe(payload);
  });

  it("writes the aes128gcm header the content coding specifies", () => {
    const device = browserSubscription();
    const salt = randomBytes(16);

    const body = encryptPushPayload(device.subscription, "{}", salt);

    expect(body.subarray(0, 16)).toEqual(salt);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
    // The key id is the sender's ephemeral public key, and it is not the browser's.
    expect(body.subarray(21, 86)).not.toEqual(device.publicKey);
    expect(body.subarray(21, 86)[0]).toBe(4);
  });

  it("uses a fresh ephemeral key for every message", () => {
    const device = browserSubscription();

    const first = encryptPushPayload(device.subscription, "{}");
    const second = encryptPushPayload(device.subscription, "{}");

    expect(first.subarray(21, 86)).not.toEqual(second.subarray(21, 86));
    expect(decrypt(first, device)).toBe("{}");
    expect(decrypt(second, device)).toBe("{}");
  });

  it("refuses a subscription whose key is not a P-256 point", () => {
    expect(() =>
      encryptPushPayload(
        { keys: { p256dh: encodeBase64Url(Buffer.alloc(10)), auth: "AAAA" } },
        "{}",
      ),
    ).toThrow(/P-256/);
  });
});

describe("vapidAuthorization", () => {
  it("signs a JWT the push service can verify with the advertised key", () => {
    const keys = vapidKeys();

    const header = vapidAuthorization("https://push.example", keys);

    const match = /^vapid t=([\w-]+\.[\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, signingInput, signature, advertisedKey] = match!;
    expect(advertisedKey).toBe(keys.publicKey);

    const point = decodeBase64Url(keys.publicKey);
    const verified = createVerify("SHA256")
      .update(signingInput!)
      .verify(
        {
          key: createPublicKey({
            format: "jwk",
            key: {
              kty: "EC",
              crv: "P-256",
              x: encodeBase64Url(point.subarray(1, 33)),
              y: encodeBase64Url(point.subarray(33, 65)),
            },
          }),
          dsaEncoding: "ieee-p1363",
        },
        decodeBase64Url(signature!),
      );
    expect(verified).toBe(true);

    const claims = JSON.parse(
      decodeBase64Url(signingInput!.split(".")[1]!).toString("utf8"),
    );
    expect(claims.aud).toBe("https://push.example");
    expect(claims.sub).toBe("mailto:ops@morrow.example");
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // RFC 8292 caps the lifetime at 24 hours.
    expect(claims.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 86_400);
  });
});

describe("createWebPushSender", () => {
  const message = (endpoint: string, device = browserSubscription(endpoint)) => ({
    device,
    message: {
      subscription: device.subscription,
      title: "Reminder: Draft the brief",
      body: "ML-000001 is due 2026-09-15 at 09:30 (Europe/Berlin).",
      url: "https://morrow.example/tasks/ML-000001",
      tag: "reminder:01a04e0f",
    },
  });

  it("posts an encrypted body with the injected clock and HTTP policy", async () => {
    const keys = vapidKeys();
    const { device, message: push } = message("https://push.example/device-1");
    const calls: { url: string; init: RequestInit }[] = [];
    const now = new Date("2026-09-12T10:00:00Z");
    const sender = createWebPushSender({
      keys,
      clock: { now: () => now },
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 201 });
      },
    });
    expect(await sender.send(push)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://push.example/device-1");
    expect(call.init.redirect).toBe("error");
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    const headers = call.init.headers as Record<string, string>;
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers["content-type"]).toBe("application/octet-stream");
    expect(headers.ttl).toBe("14400");
    const jwt = headers.authorization!.split("t=")[1]!.split(",")[0]!;
    expect(JSON.parse(decodeBase64Url(jwt.split(".")[1]!).toString()).exp).toBe(
      now.getTime() / 1000 + 12 * 60 * 60,
    );
    expect(
      JSON.parse(decrypt(Buffer.from(call.init.body as Uint8Array), device)),
    ).toEqual({ title: push.title, body: push.body, url: push.url, tag: push.tag });
  });

  it("reports 404 and 410 as gone, and other failures as transient", async () => {
    for (const status of [404, 410, 500]) {
      const sender = createWebPushSender({
        keys: vapidKeys(),
        fetch: async () => new Response(null, { status }),
      });
      const result = await sender.send(
        message(`https://push.example/${status}`).message,
      );
      expect(result).toMatchObject(
        status === 500
          ? { ok: false, error: "push service answered 500" }
          : { ok: false, gone: true },
      );
      if (status === 500) expect(result).not.toHaveProperty("gone", true);
    }
    const sender = createWebPushSender({
      keys: vapidKeys(),
      fetch: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    expect(await sender.send(message("https://push.example/offline").message)).toEqual({
      ok: false,
      error: "connect ECONNREFUSED",
    });
  });

  it("treats unusable recipient keys as gone without sending", async () => {
    let called = false;
    const sender = createWebPushSender({
      keys: vapidKeys(),
      fetch: async () => {
        called = true;
        return new Response(null, { status: 201 });
      },
    });
    const push = message("https://push.example/broken").message;
    const result = await sender.send({
      ...push,
      subscription: {
        ...push.subscription,
        keys: { p256dh: "not-a-key", auth: "AAAA" },
      },
    });
    expect(result).toMatchObject({ ok: false, gone: true });
    expect(called).toBe(false);
  });

  it.each(["publicKey", "privateKey"] as const)(
    "keeps healthy subscriptions when server %s is invalid",
    async (field) => {
      let called = false;
      const sender = createWebPushSender({
        keys: { ...vapidKeys(), [field]: "invalid" },
        fetch: async () => {
          called = true;
          return new Response(null, { status: 201 });
        },
      });
      const result = await sender.send(message("https://push.example/healthy").message);
      expect(result).toMatchObject({
        ok: false,
        error: expect.stringContaining("Web Push configuration is invalid:"),
      });
      expect(result).not.toHaveProperty("gone", true);
      expect(called).toBe(false);
    },
  );
});
