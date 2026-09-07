import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  WORKSPACE_EVENTS,
  type CalendarFeedDto,
  type CalendarFeedStatus,
} from "@morrowlist/contracts";
import { DomainError, systemClock, type Clock } from "@morrowlist/domain";

import type { UnitOfWork } from "../ports/index.js";
import {
  assertScope,
  SCOPES,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";

import { renderCalendar } from "./ics.js";

export interface CalendarFeedServiceOptions {
  unitOfWork: UnitOfWork;
  signingSecret: string;
  appUrl: string;
  clock?: Clock;
}
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export class CalendarFeedService {
  private readonly clock: Clock;
  constructor(private readonly options: CalendarFeedServiceOptions) {
    this.clock = options.clock ?? systemClock;
  }
  private user(context: ActorContext, workspaceId: string): string {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksRead);
    assertScope(context, SCOPES.calendarWrite);
    const userId =
      context.userId ?? (context.actorKind === "user" ? context.actorId : null);
    if (!userId)
      throw new DomainError(
        "AUTH_FORBIDDEN",
        "Calendar feed credentials require an authenticated user owner.",
      );
    return userId;
  }
  private signature(value: string) {
    return createHmac("sha256", this.options.signingSecret)
      .update(`calendar-feed:v1:${value}`)
      .digest("base64url");
  }
  async status(
    context: ActorContext,
    workspaceId: string,
  ): Promise<CalendarFeedStatus> {
    const userId = this.user(context, workspaceId);
    return this.options.unitOfWork.execute(async (tx) => {
      const token = await tx.calendarFeedTokens.find(userId, workspaceId);
      return {
        active: Boolean(token && !token.revokedAt),
        createdAt: token?.createdAt.toISOString() ?? null,
      };
    });
  }
  async create(context: ActorContext, workspaceId: string): Promise<CalendarFeedDto> {
    const userId = this.user(context, workspaceId);
    const nonce = randomBytes(32).toString("base64url");
    const token = `${nonce}.${this.signature(nonce)}`;
    const now = this.clock.now();
    return this.options.unitOfWork.execute(async (tx) => {
      if (!(await tx.workspaces.findMembership(workspaceId, userId)))
        throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.");
      await tx.calendarFeedTokens.replace({
        userId,
        workspaceId,
        tokenHash: hash(token),
        createdAt: now,
        revokedAt: null,
      });
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateId: workspaceId,
        aggregateType: "workspace",
        eventType: WORKSPACE_EVENTS.calendarFeedCreated,
        summary: "Created a calendar feed URL",
        payload: { userId },
      });
      return {
        url: new URL(`/api/v1/feeds/${token}.ics`, this.options.appUrl).href,
        createdAt: now.toISOString(),
      };
    });
  }
  async revoke(context: ActorContext, workspaceId: string): Promise<void> {
    const userId = this.user(context, workspaceId);
    await this.options.unitOfWork.execute(async (tx) => {
      if (await tx.calendarFeedTokens.revoke(userId, workspaceId, this.clock.now())) {
        await recordEvent(tx, context, this.clock, {
          workspaceId,
          aggregateId: workspaceId,
          aggregateType: "workspace",
          eventType: WORKSPACE_EVENTS.calendarFeedRevoked,
          summary: "Revoked the calendar feed URL",
          payload: { userId },
        });
      }
    });
  }
  async feed(token: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const [nonce, signature] = token.split(".") as [string, string];
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(this.signature(nonce))))
      return null;
    return this.options.unitOfWork.execute(async (tx) => {
      const credential = await tx.calendarFeedTokens.findByHash(hash(token));
      if (!credential || credential.revokedAt) return null;
      const membership = await tx.workspaces.findMembership(
        credential.workspaceId,
        credential.userId,
      );
      const workspace =
        membership && (await tx.workspaces.findById(credential.workspaceId));
      if (!workspace) return null;
      const page = await tx.tasks.listCalendar({
        workspaceId: workspace.id,
        from: null,
        to: null,
        limit: 10000,
      });
      if (page.truncated)
        throw new DomainError(
          "VALIDATION_FAILED",
          "Calendar feed exceeds 10,000 scheduled tasks.",
        );
      return renderCalendar(page.items, workspace, this.options.appUrl);
    });
  }
}
