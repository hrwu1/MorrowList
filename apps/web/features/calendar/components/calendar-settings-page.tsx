"use client";
import { Alert, Button, Spinner, TextInput } from "@morrowlist/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { useMe } from "@/features/workspace/hooks/use-workspace";
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
  const me = useMe();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const mint = useMutation({
    mutationFn: (accountPassword: string) =>
      apiClient.createApiToken({ password: accountPassword }),
    onSuccess: (issued) => {
      setToken(issued.token);
      setPassword("");
    },
  });
  const submitToken = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password) mint.mutate(password);
  };
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
        Apple Calendar only accepts feeds served over HTTPS.
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
      <section className="stack" aria-labelledby="caldav-heading">
        <h2 id="caldav-heading">CalDAV account</h2>
        <p>
          Add MorrowList as a CalDAV account in Apple Calendar or another CalDAV app to
          edit tasks from the calendar. Moving, renaming, creating, or deleting an event
          there changes the task here, and a stale edit is refused rather than
          overwriting a newer one. Repeating events and invitations cannot be synced.
        </p>
        <dl className="caldav-details">
          <dt>Server address</dt>
          <dd>
            <code>{origin ? `${origin}/dav/` : "…/dav/"}</code>
          </dd>
          <dt>Username</dt>
          <dd>
            <code>{me.data?.user.email ?? "your account email"}</code>
          </dd>
          <dt>Password</dt>
          <dd>An API token, created below.</dd>
        </dl>
        <form className="calendar-controls" onSubmit={submitToken}>
          <label className="stack">
            Account password
            <TextInput
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={mint.isPending || !password}>
            {mint.isPending ? "Creating…" : "Create API token"}
          </Button>
        </form>
        {mint.error ? (
          <Alert tone="error" title="API token could not be created">
            {mint.error.message}
          </Alert>
        ) : null}
        {token ? (
          <label className="stack">
            API token (shown once)
            <input
              className="calendar-feed-url"
              aria-label="API token"
              value={token}
              readOnly
              onFocus={(event) => event.target.select()}
            />
          </label>
        ) : null}
        <p>
          A token is also the key for the <code>morrow</code> CLI. It stays valid while
          it is used and expires after 30 days without use. Apple Calendar requires the
          server address to use HTTPS.
        </p>
      </section>
    </div>
  );
}
