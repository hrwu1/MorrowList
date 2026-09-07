import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  INBOUND_EVENTS,
  type InboundAddressDto,
  type InboundEmail,
  type InboundEmailResult,
} from "@morrowlist/contracts";
import {
  DomainError,
  ValidationError,
  parseCapture,
  systemClock,
  toLocalDate,
  uuidv7,
  type Clock,
} from "@morrowlist/domain";

import { defaultReminderOffset } from "../notifications/scheduler.js";
import type {
  InboundAddress,
  InboundEmailPort,
  TransactionContext,
  UnitOfWork,
} from "../ports/index.js";
import { assertWorkspaceAccess, type ActorContext } from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";
import { insertNewTask } from "../tasks/create.js";

import { emailDescription } from "./parser.js";

export interface InboundEmailOptions {
  readonly unitOfWork: UnitOfWork;
  readonly domain?: string | undefined;
  readonly webhookSecret?: string | undefined;
  readonly addressSecret: string;
  readonly clock?: Clock;
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export class InboundEmailService implements InboundEmailPort {
  private readonly clock: Clock;
  constructor(private readonly options: InboundEmailOptions) {
    this.clock = options.clock ?? systemClock;
  }
  get enabled(): boolean {
    return Boolean(this.options.domain && this.options.webhookSecret);
  }
  authorize(authorization: string | undefined): void {
    if (!this.enabled)
      throw new DomainError("AUTH_FORBIDDEN", "Email capture is not configured.");
    const actual = createHash("sha256")
      .update(authorization ?? "")
      .digest();
    const expected = createHash("sha256")
      .update(`Bearer ${this.options.webhookSecret}`)
      .digest();
    if (!timingSafeEqual(actual, expected))
      throw new DomainError("AUTH_FORBIDDEN", "Inbound authentication required.");
  }
  private token(
    address: Pick<InboundAddress, "id" | "userId" | "workspaceId">,
  ): string {
    return createHmac("sha256", this.options.addressSecret)
      .update(`${address.id}:${address.userId}:${address.workspaceId}`)
      .digest("hex");
  }
  private dto(address: InboundAddress | null): InboundAddressDto {
    return {
      enabled: this.enabled,
      address:
        address && this.enabled
          ? `${this.token(address)}@${this.options.domain}`
          : null,
      createdAt: address?.createdAt.toISOString() ?? null,
    };
  }
  private async member(
    tx: TransactionContext,
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const membership = await tx.workspaces.findMembership(workspaceId, userId);
    if (!membership || membership.role === "viewer")
      throw new DomainError(
        "AUTH_FORBIDDEN",
        "A current workspace writer is required.",
      );
  }
  private user(context: ActorContext, workspaceId: string): string {
    assertWorkspaceAccess(context, workspaceId);
    if (context.actorKind !== "user" || !context.userId)
      throw new DomainError(
        "AUTH_FORBIDDEN",
        "Manage your address using a signed-in user session.",
      );
    return context.userId;
  }
  async getAddress(
    context: ActorContext,
    workspaceId: string,
  ): Promise<InboundAddressDto> {
    const userId = this.user(context, workspaceId);
    return this.options.unitOfWork.execute(async (tx) => {
      await this.member(tx, workspaceId, userId);
      return this.dto(await tx.inboundAddresses.findCurrent(workspaceId, userId));
    });
  }
  async rotateAddress(
    context: ActorContext,
    workspaceId: string,
  ): Promise<InboundAddressDto> {
    const userId = this.user(context, workspaceId);
    if (!this.enabled)
      throw new ValidationError("Configure email capture on this server first.");
    return this.options.unitOfWork.execute(async (tx) => {
      await tx.inboundAddresses.lock(workspaceId);
      await this.member(tx, workspaceId, userId);
      const now = this.clock.now();
      const identity = { id: uuidv7(), workspaceId, userId };
      const address: InboundAddress = {
        ...identity,
        tokenHash: digest(this.token(identity)),
        createdAt: now,
        revokedAt: null,
      };
      await tx.inboundAddresses.revoke(workspaceId, userId, now);
      await tx.inboundAddresses.insert(address);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "workspace",
        aggregateId: workspaceId,
        eventType: INBOUND_EVENTS.addressRotated,
        summary: "Rotated email capture address",
        payload: { userId, addressId: address.id },
      });
      return this.dto(address);
    });
  }
  async receive(
    provider: string,
    email: InboundEmail,
    requestId: string,
  ): Promise<InboundEmailResult> {
    if (!this.enabled)
      throw new DomainError("AUTH_FORBIDDEN", "Email capture is not configured.");
    if (!["normalized", "imap", "postmark", "mailgun", "ses"].includes(provider))
      throw new ValidationError("Unsupported inbound email provider.");
    const [token, domain] = email.recipient.toLowerCase().split("@");
    const reject = () =>
      new DomainError("AUTH_FORBIDDEN", "No active capture address.");
    if (
      !token ||
      !/^[a-f0-9]{64}$/.test(token) ||
      domain !== this.options.domain?.toLowerCase()
    )
      throw reject();
    return this.options.unitOfWork.execute(async (tx) => {
      const lookup = await tx.inboundAddresses.findByTokenHash(digest(token));
      if (!lookup) throw reject();
      await tx.inboundAddresses.lock(lookup.workspaceId);
      const address = await tx.inboundAddresses.findByTokenHash(digest(token));
      if (!address) throw reject();
      await this.member(tx, address.workspaceId, address.userId);
      const workspace = await tx.workspaces.findById(address.workspaceId);
      if (!workspace) throw reject();
      const messageKey = digest(`${provider}:${email.messageId}`);
      const previous = await tx.inboundAddresses.findReceipt(address.id, messageKey);
      if (previous) return { taskId: previous, duplicate: true };
      // The recipient is a 256-bit capability; sender strings alone never authorize ingress.
      const parsed = parseCapture(
        [...email.subject.trim()].slice(0, 500).join("") || "Email capture",
        { today: toLocalDate(this.clock.now(), workspace.timezone) },
      );
      const context: ActorContext = {
        actorKind: "user",
        actorId: address.userId,
        userId: address.userId,
        workspaceIds: [workspace.id],
        scopes: new Set(),
        requestId,
      };
      const task = await insertNewTask({
        tx,
        context,
        clock: this.clock,
        workspace,
        fields: {
          id: uuidv7(),
          title: parsed.title,
          descriptionMd: emailDescription(email),
          priority: parsed.priority ?? "none",
          defaultReminderOffsetMinutes: await defaultReminderOffset(
            tx,
            context,
            workspace.id,
          ),
          dueDate: parsed.dueDate,
          dueTime: parsed.dueTime,
          dueTimezone: parsed.dueTime ? workspace.timezone : null,
          deferUntil: parsed.deferUntil,
          deadline: parsed.deadline,
          deadlineTime: parsed.deadlineTime,
          recurrence: parsed.recurrence,
        },
        origin: { importedFrom: { source: "email", id: email.messageId } },
      });
      await tx.inboundAddresses.insertReceipt(address.id, messageKey, task.id);
      return { taskId: task.id, duplicate: false };
    });
  }
}
