/**
 * Outbound email port (spec 31.3 `EMAIL_PROVIDER`). The application composes plain-text
 * messages; an adapter delivers them. Delivery happens after the transaction that decided
 * to notify has committed, so a slow or failing provider never holds a database lock.
 */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/** Test double that records what would have been sent. */
export function createRecordingEmailSender(): EmailSender & {
  readonly sent: EmailMessage[];
} {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
