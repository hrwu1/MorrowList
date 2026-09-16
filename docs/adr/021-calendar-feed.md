# ADR-021 — Calendar projection and revocable ICS subscriptions

**Status:** Accepted

**Date:** 2026-09-07

## Decision

Calendar is a projection of canonical open tasks, including deferred tasks. It reads
planned dates, hard deadlines, and defer dates in one bounded query, without a separate
calendar task model. The web view is capped at 2,000 tasks with explicit truncation and
supports month/week navigation, keyboard day navigation, dated capture, drag rescheduling,
and the existing Planned date field as a non-drag alternative.

The read-only feed renders RFC 5545 VEVENTs, which subscribed calendar clients display
consistently. Planned dates and deadlines are separate events with stable task-based UIDs;
`SEQUENCE` follows task version. Date-only entries have exclusive next-day `DTEND`; timed
entries convert their task/workspace timezone to UTC. Timed task reminder offsets become
VALARM entries. Deferred-only tasks have no calendar event until they have a planned date
or deadline. Only current open occurrences are exported; no RRULE creates speculative
future tasks. The entire feed is bounded at 10,000 scheduled tasks and fails explicitly
rather than silently omitting entries above that limit.

One active feed token exists per user/workspace, with a random nonce and a domain-separated
HMAC signature. Only the SHA-256 token hash is stored. Issuing a URL atomically replaces the
prior credential; revocation and current workspace membership are checked on every feed
request. Token mutations record non-secret activity/outbox events transactionally. User
sessions can manage feeds; non-user credentials require `tasks:read`, `calendar:write`,
and an authenticated owner user ID. Only the CLI preset gains `calendar:write`.

## Reasoning

The existing recurrence model materializes the next occurrence only after completion.
Publishing an RRULE would promise dates the canonical model has not created. VEVENTs and
UTC instants avoid depending on VTODO support or embedded timezone databases in subscribed
calendar apps. Separate deadline events preserve the difference between a planned day and
an actual deadline, including when task and workspace timezones differ.

## Consequences

- ICS is one-way. Calendar clients cannot edit MorrowList tasks. CalDAV and time blocking
  remain outside this change.
- Feed requests use `private, no-cache, max-age=0, must-revalidate`, superseding the plan's
  proposed five-minute cache. The next network request after revocation returns 404;
  previously downloaded copies and third-party refresh schedules remain client-controlled.
- Request logs redact feed paths, Next's development request logger ignores those paths,
  and the service worker never caches feed or credential endpoints. Reverse proxies and
  hosted access logs must likewise redact `/api/v1/feeds/*` to avoid recording secrets.
- A process-local ceiling of 120 feed reads/minute bounds unauthenticated work. It uses no
  untrusted IP headers and stores no per-client secrets. A multi-instance deployment needs
  an upstream shared rate limit for a deployment-wide ceiling.
- `ical.js` is a test-only parser dependency. Production rendering adds no dependency.
- Apple Calendar (macOS 26.5) was checked on 2026-09-16: date-only, timed, and deadline
  entries land on the right day and local time. Apple Calendar only fetches feeds over
  HTTPS with a certificate the Mac trusts: it retries a `webcal://` or `http://` URL over
  TLS after its "Insecure Connection" prompt and fails silently on an untrusted
  certificate. A deployment must serve `APP_URL` over HTTPS for Apple subscriptions.
  Google Calendar display remains an external acceptance check.
