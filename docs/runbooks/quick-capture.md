# Quick capture

Open `/capture` to add one thought to the Inbox. Dates, times, priorities and recurrence
use the existing quick-add parser; its device preference and backslash escapes apply.
The preview shows what will be saved. Keep the page open while offline and submit after
reconnecting. Project and tag markers remain literal here because this window targets Inbox.

## Desktop launchers

In the focused browser or installed PWA, **Cmd/Ctrl + Shift + Space** opens Quick capture.
This in-app shortcut is not an operating-system hotkey. If the OS reserves it, use the
launcher below or the Quick capture link in Workspace settings.

On macOS, create a Shortcuts action **Open URLs** with `https://YOUR-HOST/capture`, then
assign its keyboard shortcut in Shortcuts. For selected text, use **URL Encode** on the
shortcut input and append it to `/capture?text=` before Open URLs. A terminal equivalent:

```sh
open 'https://YOUR-HOST/capture'
```

On Windows, create a shortcut targeting your installed browser with
`https://YOUR-HOST/capture`; assign a key in shortcut Properties, or use PowerToys Keyboard
Manager's shortcut-to-open-URI action. URL-encode selected text before appending `?text=`.
The app itself never changes global keyboard settings.

## Phone sharing and bookmarklet

Install the PWA from a compatible browser. The manifest registers a POST share target at
`/capture/share` with title, text and URL. Signed-in native shares create a task and open
it. Signed-out shares preserve the fields through sign-in and open a capture preview.
If the fully encoded sign-in URL would exceed 6,000 characters, the response keeps the
original fields visible for copying and asks for a shorter selection. Long signed-in
native shares can still create tasks directly.
Cross-site website forms also require preview submission. If the operating system does
not offer the PWA in its share sheet, use the capture URL or bookmarklet.

Workspace settings includes a copyable bookmarklet. Create a bookmark named **Capture to
MorrowList**, edit its URL, and paste the copied code. Running it opens the current title
and URL in a small capture window. Saving closes a script-opened window; otherwise it
opens the created task. Browser restrictions may prevent bookmarklets on privileged pages.
No extension has been added: there is no usage evidence that this bookmarklet is insufficient.

## Receiving email

Configure your receiving domain/MX with your provider, then set these server variables:

- `INBOUND_EMAIL_DOMAIN`: the dedicated receiving domain, for example `inbox.example.com`.
- `INBOUND_EMAIL_SECRET`: a random secret of at least 32 characters, supplied by the ingress
  adapter as `Authorization: Bearer …`. Keep it in deployment secrets, never a webhook URL.
- `AUTH_SECRET`: the existing application secret also derives per-user capability tokens.

Email capture is disabled unless the domain and delivery secret are both configured.
Create or rotate your personal address in Workspace settings. A rotation immediately
invalidates old addresses. Rotating `AUTH_SECRET` also requires rotating capture addresses.
Only address digests are stored; addresses and message contents never enter activity payloads.
Do not log HTTP bodies or authorization headers in the reverse proxy/provider adapter.

Send to `POST /inbound/email?provider=normalized` (also available under `/api/v1`) with:

```json
{
  "messageId": "stable-provider-message-id",
  "recipient": "USER-CAPABILITY@inbox.example.com",
  "from": "sender@example.com",
  "subject": "Call Sam tomorrow 5pm",
  "text": "Notes for the call",
  "html": "",
  "attachmentCount": 0
}
```

The bearer secret authenticates the adapter; the 256-bit recipient grants capture to the
specific user/workspace. A From string is never sufficient. Current writer membership is
checked for every delivery. Address rotation and delivery serialize; receipts deduplicate
retries by recipient, provider and message id, transactionally with task/activity/outbox.
Retries must retain the same provider and stable message id. Do not change adapter mode
for the same already-delivered mail. The body cap is 1 MB; text is 200,000 characters and
HTML 500,000. The final sanitized description is capped at 50,000 characters, including
a truncation notice when needed and any attachment note, so captured tasks remain editable.
Attachments are ignored and noted; HTML becomes plain Markdown text, common
quoted reply lines are removed, and subject parsing resolves dates in workspace time.

Provider shape adapters are `postmark`, `mailgun` (JSON or form fields), `ses`, and `imap`.
Postmark uses `MessageID`, `OriginalRecipient`/`To`, `Subject`, `TextBody`, `HtmlBody` and
`Attachments`; Mailgun uses `Message-Id`, `recipient`, `subject`, `body-plain`/`stripped-text`,
`body-html` and `attachment-count`. Configure an authenticated forwarding relay if the
provider cannot attach the bearer header. The app never trusts an unsigned direct SNS POST.

For SES, a relay must verify SNS signatures/subscription ownership using AWS-supported
validation, retrieve/parse the MIME body as configured in the SES receipt action, then
forward the decoded `mail`/`receipt` object with extracted `text`/`html` and attachment count.
It must forward one recipient per request. SNS subscription-confirmation URLs are never
followed by MorrowList. The app does not fetch arbitrary S3 URLs or MIME attachments.

## Optional self-hosted IMAP

`python3 scripts/inbound-imap.py --once` uses Python's standard TLS IMAP client and delivers
through the same normalized port. Set `IMAP_HOST`, optional `IMAP_PORT` (993), `IMAP_USER`,
`IMAP_PASSWORD`, optional `IMAP_MAILBOX` (INBOX), `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_URL`
and `INBOUND_EMAIL_SECRET` in the bridge environment. Use HTTPS except on loopback. The
bridge refuses redirects so ingress credentials stay at the configured endpoint.

Without `--once`, it polls every 60 seconds (`--interval` changes this). It selects up to 50
unread messages each interval, ignores messages over 500 KB, and marks each message seen
only after every capture recipient returns success. Failed messages remain unread. Use a
dedicated mailbox and one bridge process; retained unread poison messages require operator
review. No mailbox credentials or provider account was configured during implementation.

## Acceptance evidence

Local automated checks cover normalized/provider parsing, authentication, membership,
rotation, deduplication, rollback, browser capture and signed-out share preservation.
Actual Android Chrome/iOS Safari share-sheet availability, real provider delivery, real
mailbox polling and OS-level launcher invocation require configured accounts/devices and
remain unverified. No extension demand or delivery latency measurement is claimed.
