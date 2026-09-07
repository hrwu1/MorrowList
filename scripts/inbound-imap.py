#!/usr/bin/env python3
"""Optional TLS IMAP bridge. Configure env; run --once or poll. No third-party packages."""
import argparse
import email.policy
from email.parser import BytesParser
from email.utils import getaddresses
import imaplib
import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_MESSAGE_BYTES = 500_000


def normalize_message(raw, fallback_id, domain):
    message = BytesParser(policy=email.policy.default).parsebytes(raw)
    headers = message.get_all("Delivered-To", []) + message.get_all("X-Original-To", []) + message.get_all("To", [])
    recipients = {address.lower() for _, address in getaddresses(headers)
                  if re.fullmatch(r"[a-f0-9]{64}@" + re.escape(domain.lower()), address.lower())}
    if not recipients:
        raise ValueError("No capture recipient found")
    text, html, attachments = [], [], 0
    def read_part(part):
        nonlocal attachments
        if part.get_content_disposition() == "attachment" or part.get_filename():
            attachments += 1
            return
        if part.is_multipart():
            for child in part.iter_parts():
                read_part(child)
        elif part.get_content_type() in ("text/plain", "text/html"):
            content = part.get_content()
            (text if part.get_content_type() == "text/plain" else html).append(content)
    read_part(message)
    base = {"messageId": str(message.get("Message-ID", fallback_id)),
            "from": str(message.get("From", "")), "subject": str(message.get("Subject", "")),
            "text": "\n".join(text), "html": "\n".join(html), "attachmentCount": attachments}
    return [{**base, "recipient": address} for address in sorted(recipients)]


def poll(settings):
    with imaplib.IMAP4_SSL(settings["IMAP_HOST"], int(settings.get("IMAP_PORT", "993")), ssl_context=ssl.create_default_context(), timeout=30) as mailbox:
        mailbox.login(settings["IMAP_USER"], settings["IMAP_PASSWORD"])
        status, _ = mailbox.select(settings.get("IMAP_MAILBOX", "INBOX"))
        if status != "OK":
            raise RuntimeError("Unable to select mailbox")
        validity = mailbox.response("UIDVALIDITY")[1][0].decode()
        status, unseen = mailbox.uid("search", None, "UNSEEN")
        if status != "OK":
            raise RuntimeError("Unable to search mailbox")
        for uid in unseen[0].split()[:50]:
            status, metadata = mailbox.uid("fetch", uid, "(RFC822.SIZE)")
            match = re.search(rb"RFC822.SIZE (\d+)", b" ".join(item for item in metadata if isinstance(item, bytes)))
            if status != "OK" or not match or int(match[1]) > MAX_MESSAGE_BYTES:
                print("Skipped oversized or unreadable message", flush=True)
                continue
            status, parts = mailbox.uid("fetch", uid, "(BODY.PEEK[])")
            if status != "OK":
                continue
            raw = next((part[1] for part in parts if isinstance(part, tuple)), b"")
            if len(raw) > MAX_MESSAGE_BYTES:
                continue
            try:
                envelopes = normalize_message(raw, f"{validity}:{uid.decode()}", settings["INBOUND_EMAIL_DOMAIN"])
                for envelope in envelopes:
                    request = urllib.request.Request(settings["INBOUND_EMAIL_URL"], data=json.dumps(envelope).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + settings["INBOUND_EMAIL_SECRET"]}, method="POST")
                    # No redirect following: credentials must remain at the configured ingress.
                    class NoRedirect(urllib.request.HTTPRedirectHandler):
                        def redirect_request(self, *args, **kwargs):
                            return None
                    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
                        if response.status not in (200, 201):
                            raise RuntimeError("Ingress refused message")
                mailbox.uid("store", uid, "+FLAGS", "(\\Seen)")
            except (ValueError, RuntimeError, urllib.error.URLError):
                # Keep unread for retry. Never log the address, contents or credentials.
                print("Message was not accepted; retained unread for retry", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=int, default=60)
    args = parser.parse_args()
    settings = dict(os.environ)
    required = ("IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD", "INBOUND_EMAIL_DOMAIN", "INBOUND_EMAIL_URL", "INBOUND_EMAIL_SECRET")
    if any(not settings.get(key) for key in required):
        parser.error("Set " + ", ".join(required))
    url = urllib.parse.urlsplit(settings["INBOUND_EMAIL_URL"])
    if url.scheme != "https" and not (url.scheme == "http" and url.hostname in ("localhost", "127.0.0.1", "::1")):
        parser.error("INBOUND_EMAIL_URL requires HTTPS except on loopback")
    if url.username or url.password or url.fragment or args.interval < 5:
        parser.error("Do not put credentials in the URL; interval must be at least 5 seconds")
    query = urllib.parse.parse_qs(url.query)
    query["provider"] = ["imap"]
    settings["INBOUND_EMAIL_URL"] = urllib.parse.urlunsplit(url._replace(query=urllib.parse.urlencode(query, doseq=True)))
    while True:
        try:
            poll(settings)
        except (OSError, imaplib.IMAP4.error, RuntimeError):
            if args.once:
                raise SystemExit("IMAP delivery failed; check connection and configuration")
            print("IMAP delivery failed; retrying next interval", flush=True)
        if args.once:
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
