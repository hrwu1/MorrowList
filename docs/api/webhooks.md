# Webhooks

MorrowList POSTs every workspace event to the endpoints you register. The payload is the
domain event envelope from spec 19.6 — the same envelope stored in the transactional
outbox, so a webhook subscriber sees exactly what the application recorded.

Manage endpoints in **Settings → Webhooks**, with `morrow webhook`, or through
`/api/v1/webhooks` (see `docs/api/openapi.json`).

## The envelope

```json
{
  "id": "01996c5d-0000-7000-8000-00000000000a",
  "schemaVersion": 1,
  "type": "task.updated",
  "aggregateType": "task",
  "aggregateId": "01996c1f-0000-7000-8000-000000000001",
  "workspaceId": "01996b00-0000-7000-8000-000000000002",
  "actor": { "kind": "user", "id": "01996a00-0000-7000-8000-000000000003" },
  "occurredAt": "2026-09-05T09:00:00.000Z",
  "correlationId": "req_01H...",
  "payload": {
    "taskId": "01996c1f-0000-7000-8000-000000000001",
    "changes": {
      "title": { "from": "Draft brief", "to": "Draft the brief" },
      "priority": { "from": "none", "to": "high" }
    }
  },
  "delivery": {
    "id": "01996c5e-0000-7000-8000-00000000000b",
    "subscriptionId": "01996c5f-0000-7000-8000-00000000000c",
    "attempt": 1
  }
}
```

`payload` is the stored event payload, passed through unchanged. For `task.updated` that
means the field-level diff the command recorded, so you can see what moved without
re-reading the task. Unknown fields may be added at any time; ignore what you do not
recognise (spec 20.1).

## Headers

| Header              | Meaning                                                     |
| ------------------- | ----------------------------------------------------------- |
| `Morrow-Signature`  | `t=<unix seconds>,v1=<hex HMAC-SHA256>` — see below          |
| `Morrow-Delivery`   | This delivery attempt's id; also in `delivery.id`            |
| `Morrow-Event`      | The outbox event id. Absent on a test delivery               |
| `Morrow-Event-Type` | The event type, so you can route before parsing              |
| `Morrow-Attempt`    | 1 on the first try, up to 4                                  |

## Verifying a delivery

The secret is shown **once**, when the endpoint is created. MorrowList stores only its
SHA-256 digest and signs with that digest, so the string you were given cannot be read
back out of the database. Your receiver hashes its own copy to get the same key.

The signed string is `<timestamp>.<raw request body>`. Compare with a constant-time
comparison, and reject anything older than five minutes so a captured delivery cannot be
replayed.

```js
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const REPLAY_WINDOW_SECONDS = 300;

/** `rawBody` must be the exact bytes received — not a re-serialised object. */
export function verifyMorrowSignature(secret, rawBody, signatureHeader) {
  const fields = Object.fromEntries(
    signatureHeader.split(",").map((part) => part.trim().split("=")),
  );
  const timestamp = Number(fields.t);
  if (!Number.isFinite(timestamp) || !fields.v1) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > REPLAY_WINDOW_SECONDS) return false;

  const key = createHash("sha256").update(secret, "utf8").digest();
  const expected = createHmac("sha256", key)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest();
  const received = Buffer.from(fields.v1, "hex");

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}
```

The same function, written once, is what MorrowList's own tests use:
`verifySignature` in `packages/application/src/webhooks/signature.ts`. If this snippet and
the sender ever disagree, `signature.test.ts` fails.

### What the digest does and does not protect

Storing `sha256(secret)` means a database read cannot recover the secret string you were
shown — which matters if you reused it elsewhere. It does **not** make forgery harder for
someone who already has the stored digest: with any shared-secret HMAC scheme, whoever
holds the signing key can sign. Treat the digest as a credential.

## Responding

Answer `2xx` as soon as you have durably accepted the delivery; do the work afterwards.
MorrowList waits at most 10 seconds and follows no redirects.

Anything else — a non-2xx status, a timeout, a DNS or TLS failure — is a failed attempt.
Failures are retried after **1 minute**, **1 hour** and **6 hours**. After the fourth
failed attempt the delivery is dead-lettered and shows in the delivery log as _Gave up_.
Nothing is retried after that until someone presses **Retry** in the settings page or runs
`morrow webhook retry <id> <deliveryId>`, which queues it again with a fresh budget.

## At-least-once, not exactly-once

A delivery you have already accepted can arrive again if your `2xx` was lost on the way
back. Deduplicate on the event id (`Morrow-Event`, or `id` in the body), which is stable
across attempts. `delivery.attempt` tells you which try you are looking at.

## Event types

An endpoint subscribes to exact types (`task.completed`), aggregate prefixes (`task.*`), or
everything (`*`). `*` includes event types added in future releases. The catalogue lives in
`packages/contracts/src/events.ts`.

An endpoint only receives events that occurred at or after it was created: adding an
endpoint never replays history at it.

## Testing an endpoint

**Send test** posts a `webhook.test` event immediately, signed the same way, and records
the result in the delivery log. It is never retried — a test that turns green ten minutes
later tells you nothing — and it carries no `Morrow-Event` header because there is no
stored event behind it.

## Ordering

Deliveries are attempted oldest-first, but a retry means a later event can arrive before an
earlier one. Use `occurredAt` if order matters to you.
