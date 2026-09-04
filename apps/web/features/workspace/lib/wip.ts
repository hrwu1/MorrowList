/** Shell counter wording and tone for the cross-project in-progress limit (GAP-20). */

export type WipTone = "none" | "under" | "at" | "over";

export interface WipSummary {
  readonly label: string;
  readonly tone: WipTone;
}

export function describeInProgress(count: number, limit: number | null): WipSummary {
  if (limit === null) {
    return { label: `${count} in progress`, tone: "none" };
  }
  const label = `${count} of ${limit} in progress`;
  if (count > limit) return { label, tone: "over" };
  if (count === limit) return { label, tone: "at" };
  return { label, tone: "under" };
}
