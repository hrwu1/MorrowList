import { inboundEmailSchema, type InboundEmail } from "@morrowlist/contracts";
import { ValidationError } from "@morrowlist/domain";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
function emailAddress(value: unknown): string {
  const raw = string(value);
  return raw.match(/<([^<>]+)>/)?.[1] ?? raw;
}
/** Provider shape conversion only; all adapters finish with the same bounded schema. */
export function parseInboundEmail(provider: string, raw: unknown): InboundEmail {
  const body = record(raw);
  let input: unknown;
  if (provider === "normalized" || provider === "imap") input = body;
  else if (provider === "postmark") {
    const recipients = body.ToFull;
    if (Array.isArray(recipients) && recipients.length > 1)
      throw new ValidationError("Deliver one recipient per request.");
    input = {
      messageId: body.MessageID,
      recipient: emailAddress(body.OriginalRecipient ?? body.To),
      from: body.From,
      subject: body.Subject,
      text: body.TextBody,
      html: body.HtmlBody,
      attachmentCount: count(body.Attachments),
    };
  } else if (provider === "mailgun") {
    input = {
      messageId: body["Message-Id"] ?? body["message-id"],
      recipient: body.recipient,
      from: body.sender ?? body.from,
      subject: body.subject,
      text: body["stripped-text"] ?? body["body-plain"],
      html: body["body-html"],
      attachmentCount: Number(body["attachment-count"] ?? 0),
    };
  } else if (provider === "ses") {
    // An authenticated relay must verify SNS before forwarding this decoded notification.
    const mail = record(body.mail),
      common = record(mail.commonHeaders);
    const recipients = record(body.receipt).recipients ?? mail.destination;
    if (!Array.isArray(recipients) || recipients.length !== 1)
      throw new ValidationError("Deliver one SES recipient per request.");
    input = {
      messageId: mail.messageId,
      recipient: recipients[0],
      from: mail.source,
      subject: common.subject,
      text: body.text,
      html: body.html,
      attachmentCount: body.attachmentCount,
    };
    if (typeof body.text !== "string" && typeof body.html !== "string")
      throw new ValidationError(
        "The SES relay must extract MIME text or HTML before delivery.",
      );
  } else throw new ValidationError("Unsupported inbound email provider.");
  const result = inboundEmailSchema.safeParse(input);
  if (!result.success) throw new ValidationError("Invalid inbound email envelope.");
  return result.data;
}

export function emailDescription(email: InboundEmail): string | null {
  const body =
    email.text.trim() ||
    email.html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
      .replace(/<(br|\/p|\/div|\/li)\b[^>]*>/gi, "\n")
      .replace(/<[^<>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'");
  const lines: string[] = [];
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(On .+wrote:|-{2,}\s*Original Message\s*-*)\s*$/i.test(line)) break;
    if (!/^\s*>/.test(line)) lines.push(line);
  }
  // No active HTML is carried into Markdown, even in the plain-text alternative.
  const text = lines.join("\n").trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    [
      text,
      email.attachmentCount ? `[${email.attachmentCount} attachment(s) omitted.]` : "",
    ]
      .filter(Boolean)
      .join("\n\n") || null
  );
}
