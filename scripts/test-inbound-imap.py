"""Offline MIME fixtures for the optional IMAP bridge."""
import importlib.util
from pathlib import Path
from email.message import EmailMessage
import unittest

spec = importlib.util.spec_from_file_location("inbound_imap", Path(__file__).with_name("inbound-imap.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class MimeTests(unittest.TestCase):
    def test_alternatives_and_nested_attachments(self):
        message = EmailMessage()
        message["To"] = "a" * 64 + "@inbox.example.com"
        message["Message-ID"] = "<stable@example.com>"
        message["Subject"] = "Café tomorrow"
        message.set_content("Visible notes")
        message.add_alternative("<p>Visible notes</p>", subtype="html")
        attachment = EmailMessage()
        attachment.set_content("Do not capture attached message")
        message.add_attachment(attachment)
        result = bridge.normalize_message(message.as_bytes(), "fallback", "inbox.example.com")
        self.assertEqual(result[0]["messageId"], "<stable@example.com>")
        self.assertEqual(result[0]["attachmentCount"], 1)
        self.assertNotIn("Do not capture", result[0]["text"])
        self.assertIn("Visible notes", result[0]["text"])
        self.assertEqual(result[0]["subject"], "Café tomorrow")

    def test_unrecognized_recipient_stays_unread(self):
        with self.assertRaises(ValueError):
            bridge.normalize_message(b"To: someone@example.com\r\n\r\nhello", "fallback", "inbox.example.com")

if __name__ == "__main__":
    unittest.main()
