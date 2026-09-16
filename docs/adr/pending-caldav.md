# ADR-024 — CalDAV server for two-way calendar sync

**Status:** Accepted

**Date:** 2026-09-16

## Decision

MorrowList serves CalDAV at `/dav/` (RFC 4791 with RFC 6578 sync-collection). Each
workspace is one calendar collection; each open task with a planned date is a VEVENT
resource, and a deadline is a second, labelled resource. Calendar clients edit tasks through
the same `TaskService` commands as the API, so a client edit is one audited mutation with
its activity and outbox rows, and a stale edit is refused with `412` from the task version.

- **Transport.** Next route handlers only route the seven common HTTP methods, so a
  Node-runtime `middleware.ts` matched to `/dav/:path*` and `/.well-known/caldav` hands the
  raw request to a Hono app and returns its response. Next stops redirecting trailing
  slashes (`skipTrailingSlashRedirect`) because collections end in one; the REST app
  matches both forms itself.
- **Credentials.** Clients send HTTP Basic. The username is the account email and the
  password a personal API token, which is a Better Auth session minted by
  `POST /me/tokens` after re-checking the account password. The DAV app rewrites Basic to
  the bearer form the auth port already understands. A token is independent of the
  browser session and expires after 30 days without use.
- **Identity and round trips.** A client chooses the resource name and UID on `PUT`;
  `caldav_objects` records both, plus the VEVENT properties MorrowList does not model
  (a DTEND as a DURATION, LOCATION, and the like), so they come back on the next read.
  Canonical task fields always win. Tasks the client never wrote are served under their
  id. A trashed task keeps its row so every client learns of the removal by the name it
  knows.
- **Change tracking.** `getctag` and the sync token are the newest task `updatedAt` and
  the task count in the workspace, trashed tasks included. `sync-collection` walks tasks
  changed since the token; trashed and completed ones report as `404` removals. Nothing
  hard-deletes tasks, so a token never expires; a token this server did not issue answers
  `valid-sync-token` and the client restarts.
- **Refusals.** RRULE, RDATE, EXDATE, RECURRENCE-ID, ATTENDEE, and ORGANIZER are refused
  with a `403` and a CalDAV precondition element, so Calendar.app shows the message and
  reverts rather than diverging silently. `PROPPATCH`, `MKCALENDAR`, `MOVE`, and `COPY`
  are refused: calendar metadata lives in MorrowList. Only VEVENT is advertised, which
  keeps Reminders.app from trying to add VTODOs; that is a later decision.
- **Parsing.** `ical.js` parses client bodies and becomes a runtime dependency of the
  application package. A small namespace-aware XML reader in the API package covers the
  request bodies WebDAV needs instead of a dependency.

## Consequences

- Any CalDAV client gets two-way sync of dated tasks with no per-client integration.
- Time ranges in `calendar-query` are ignored: every open dated task is a live entry, and
  the projection is capped at 10,000 resources like the ICS feed.
- A reverse proxy must pass WebDAV methods through and forward `/.well-known/caldav`.
  Apple clients require HTTPS with a trusted certificate (ADR-021's finding applies).
- The token endpoint re-checks the password, so accounts that only sign in through GitHub
  cannot mint one until they set a password.
