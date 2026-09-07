"use client";
import { Alert, Button, Spinner } from "@morrowlist/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { apiClient } from "@/lib/api-client";
import "./calendar.css";

export function CalendarSettingsPage() {
  const client = useQueryClient();
  const [url, setUrl] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ["calendar-feed"],
    queryFn: () => apiClient.getCalendarFeedStatus(),
  });
  const create = useMutation({
    mutationFn: () => apiClient.createCalendarFeed(),
    onSuccess: (feed) => {
      setUrl(feed.url);
      void client.invalidateQueries({ queryKey: ["calendar-feed"] });
    },
  });
  const revoke = useMutation({
    mutationFn: () => apiClient.revokeCalendarFeed(),
    onSuccess: () => {
      setUrl(null);
      void client.invalidateQueries({ queryKey: ["calendar-feed"] });
    },
  });
  const error = create.error ?? revoke.error ?? status.error;
  const busy = create.isPending || revoke.isPending;
  return (
    <div className="stack">
      <header className="page-header">
        <h1>Calendar subscription</h1>
        <p className="page-header__subtitle">
          Read your open tasks in Apple Calendar, Google Calendar, or another calendar
          app.
        </p>
      </header>
      <Link href="/calendar">Back to Calendar</Link>
      <p>
        Subscribe by URL in your calendar app. The feed includes planned dates,
        deadlines, and timed reminders. Calendar apps choose how often they refresh.
      </p>
      <p>
        Anyone holding this private URL can read your scheduled tasks. Save it when
        created; it is shown only once. Creating another URL revokes the previous one.
      </p>
      {status.isPending ? (
        <Spinner label="Loading calendar subscription" />
      ) : (
        <p role="status">
          {status.data?.active
            ? "A calendar feed is active."
            : "No calendar feed is active."}
        </p>
      )}
      {error ? (
        <Alert tone="error" title="Calendar subscription could not be updated">
          {error.message}
        </Alert>
      ) : null}
      <div className="calendar-controls">
        <Button
          disabled={busy || status.isPending || status.isError}
          onClick={() => create.mutate()}
        >
          {create.isPending
            ? "Creating…"
            : status.data?.active
              ? "Replace feed URL"
              : "Create feed URL"}
        </Button>
        {status.data?.active ? (
          <Button disabled={busy} onClick={() => revoke.mutate()}>
            {revoke.isPending ? "Revoking…" : "Revoke feed URL"}
          </Button>
        ) : null}
      </div>
      {url ? (
        <label className="stack">
          Private calendar feed URL
          <input
            className="calendar-feed-url"
            aria-label="Private calendar feed URL"
            value={url}
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </label>
      ) : null}
    </div>
  );
}
