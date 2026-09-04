"use client";

import Link from "next/link";

import { useDefaultWorkspace } from "../hooks/use-workspace";
import { describeInProgress } from "../lib/wip";

/**
 * "3 of 3 in progress": started work across every project against the workspace limit
 * (GAP-20). It links to the workspace settings, where the limit is set.
 */
export function WipCounter({
  current,
  onNavigate,
}: {
  readonly current: boolean;
  readonly onNavigate?: (() => void) | undefined;
}) {
  const workspace = useDefaultWorkspace();
  const summary = workspace
    ? describeInProgress(workspace.inProgressCount, workspace.inProgressLimit)
    : null;

  return (
    <Link
      className="workspace-nav__link workspace-wip"
      href="/settings/workspace"
      aria-current={current ? "page" : undefined}
      aria-label={
        summary ? `${summary.label}. Workspace settings` : "Workspace settings"
      }
      data-tone={summary?.tone}
      {...(onNavigate ? { onClick: onNavigate } : {})}
    >
      <span className="workspace-wip__mark" aria-hidden="true" />
      <span className="workspace-wip__label" aria-hidden="true">
        {summary?.label ?? "In progress"}
      </span>
    </Link>
  );
}
