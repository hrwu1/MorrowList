import type { EmailSender, PushSender } from "@morrowlist/application";
import { endpointOrigin } from "@morrowlist/application";
import type { Logger } from "@morrowlist/observability";

/** The `console` provider: development and self-hosters without a mail server. */
export function createConsoleEmailSender(logger: Logger): EmailSender {
  return {
    async send(message) {
      logger.info("email", {
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}

/** The `console` provider: development and self-hosters without VAPID keys configured. */
export function createConsolePushSender(logger: Logger): PushSender {
  return {
    async send(message) {
      // The endpoint is a device credential, so only its origin is logged (spec 27.1).
      logger.info("push", {
        endpoint: endpointOrigin(message.subscription.endpoint),
        title: message.title,
        body: message.body,
        url: message.url,
      });
      return { ok: true };
    },
  };
}
