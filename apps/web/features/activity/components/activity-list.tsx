"use client";

import type { ActivityEntryDto } from "@morrowlist/contracts";
import { Alert, Button, Spinner } from "@morrowlist/ui";

import { useActivity, type ActivitySource } from "../hooks/use-activity";
import {
  absoluteTime,
  actorBadge,
  actorLabel,
  formatChange,
  relativeTime,
} from "../lib/activity-view";

/**
 * Read-only, paginated history (ACT-001, spec 10.2). Renders summaries and mapped
 * changes only: the payload is data for other clients, never markup here (spec 26.2).
 */
export function ActivityList({
  source,
  label,
}: {
  readonly source: ActivitySource;
  readonly label: string;
}) {
  const activity = useActivity(source);

  if (activity.isPending) {
    return (
      <div className="task-list__status">
        <Spinner label="Loading activity" />
      </div>
    );
  }

  if (activity.isError) {
    return (
      <Alert tone="error" title="Activity could not be loaded">
        <p>
          {activity.error instanceof Error
            ? activity.error.message
            : "Something went wrong."}
        </p>
        <Button onClick={() => void activity.refetch()}>Try again</Button>
      </Alert>
    );
  }

  const entries = activity.data.pages.flatMap((page) => page.data);
  if (entries.length === 0) {
    return <p className="task-detail__hint">No activity yet.</p>;
  }

  return (
    <div className="stack-tight">
      <ol className="activity__list" aria-label={label}>
        {entries.map((entry) => (
          <ActivityItem key={entry.id} entry={entry} />
        ))}
      </ol>
      {activity.hasNextPage ? (
        <div className="button-row">
          <Button
            loading={activity.isFetchingNextPage}
            onClick={() => void activity.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ActivityItem({ entry }: { readonly entry: ActivityEntryDto }) {
  const badge = actorBadge(entry);
  return (
    <li className="activity__item">
      <p className="activity__summary">{entry.summary}</p>
      <p className="activity__meta">
        <span>{actorLabel(entry)}</span>
        {badge ? <span className="activity__badge">{badge}</span> : null}
        <time dateTime={entry.createdAt} title={absoluteTime(entry.createdAt)}>
          {relativeTime(entry.createdAt, Date.now())}
        </time>
      </p>
      {entry.changes.length > 0 ? (
        <ul className="activity__changes">
          {entry.changes.map((change) => (
            <li key={change.field}>{formatChange(change)}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
