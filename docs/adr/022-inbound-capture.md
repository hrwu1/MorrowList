# ADR-022: External capture uses canonical task creation

**Status:** Accepted

**Date:** 2026-09-07 (GAP-22)

## Decision

The approved capture plan brings email, PWA sharing, a capture window and a bookmarklet
into scope. The email adapter is a limited exception to ADR-016's client-only parsing:
it calls the same pure parser using workspace time, then creates an Inbox task in one
transaction. Public `POST /tasks` remains literal. Unknown project and tag markers stay
in the title; mail never moves work into an unexpected project.

Inbound requests require a deployment bearer secret and an unguessable recipient address.
No From header grants access. Addresses derive a 256-bit token using HMAC and the existing
application secret; only the token digest is persisted. Rotation records a workspace
activity and outbox event without secrets. Membership is checked on every delivery.

A receipt keyed by address plus a digest of provider/message id prevents duplicate tasks,
including concurrent delivery and retries. Receipt, task, activity and outbox commit together.
Creation provenance uses the existing `importedFrom: { source: "email", id }` extension;
the existing persisted `task.created` shape is unchanged.

GET `/capture` coexists with POST `/capture/share` rather than an invalid Next.js page and
route handler at the same path. The public share endpoint preserves fields for login when
needed. Browser and OS capture remain online, consistent with ADR-008.

## Consequences

- Email capture requires a configured receiving domain and an authenticated provider or
  relay. SES SNS must be verified by that relay; unsigned direct SNS is not accepted.
- Rotating the application secret requires rotating email addresses. Database readers
  cannot reconstruct addresses without the application secret.
- Optional IMAP uses a TLS Python standard-library bridge into the normalized webhook,
  with no new production dependency. Mailbox configuration is a deployment responsibility.
- Device-native sharing and global OS shortcuts require device checks. A browser extension
  remains conditional on evidence that the bookmarklet is insufficient.
