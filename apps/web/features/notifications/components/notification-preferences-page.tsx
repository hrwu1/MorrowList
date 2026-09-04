"use client";

import type { NotificationPreferencesDto } from "@morrowlist/contracts";
import { Alert, Button, Field, Select, Spinner, TextInput } from "@morrowlist/ui";
import { useId, useState, type FormEvent } from "react";

import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "../hooks/use-notifications";
import { REMINDER_OPTIONS } from "../lib/notification-view";

/** Channels, daily digest, and the default reminder for new timed tasks (GAP-13). */
export function NotificationPreferencesPage() {
  const preferences = useNotificationPreferences();
  // Lives here, not in the form: a save refreshes the data and remounts the form.
  const [saved, setSaved] = useState(false);

  return (
    <div className="notification-settings stack">
      <header className="page-header">
        <h1>Notification settings</h1>
        <p className="page-header__subtitle">
          One reminder per task and at most one digest a day. Nothing is sent by a
          channel you have not switched on.
        </p>
      </header>

      {preferences.isPending ? (
        <div className="task-list__status">
          <Spinner label="Loading settings" />
        </div>
      ) : preferences.isError ? (
        <Alert tone="error" title="Settings could not be loaded">
          <p>
            {preferences.error instanceof Error
              ? preferences.error.message
              : "Something went wrong."}
          </p>
          <Button onClick={() => void preferences.refetch()}>Try again</Button>
        </Alert>
      ) : (
        <PreferencesForm
          key={JSON.stringify(preferences.data)}
          current={preferences.data}
          saved={saved}
          onSaved={() => setSaved(true)}
        />
      )}
    </div>
  );
}

function PreferencesForm({
  current,
  saved,
  onSaved,
}: {
  readonly current: NotificationPreferencesDto;
  readonly saved: boolean;
  readonly onSaved: () => void;
}) {
  const update = useUpdateNotificationPreferences();
  const id = useId();
  const [inApp, setInApp] = useState(current.channels.inApp);
  const [email, setEmail] = useState(current.channels.email);
  const [digestOn, setDigestOn] = useState(current.digestTime !== null);
  const [digestTime, setDigestTime] = useState(current.digestTime ?? "08:00");
  const [timezone, setTimezone] = useState(current.timezone ?? "");
  const [offset, setOffset] = useState(current.defaultOffsetMinutes);

  const nextDigest = digestOn ? digestTime : null;
  const nextTimezone = timezone.trim() || null;
  const dirty =
    inApp !== current.channels.inApp ||
    email !== current.channels.email ||
    nextDigest !== current.digestTime ||
    nextTimezone !== current.timezone ||
    offset !== current.defaultOffsetMinutes;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    try {
      await update.mutateAsync({
        ...(inApp !== current.channels.inApp || email !== current.channels.email
          ? { channels: { inApp, email } }
          : {}),
        ...(nextDigest !== current.digestTime ? { digestTime: nextDigest } : {}),
        ...(nextTimezone !== current.timezone ? { timezone: nextTimezone } : {}),
        ...(offset !== current.defaultOffsetMinutes
          ? { defaultOffsetMinutes: offset }
          : {}),
      });
      onSaved();
    } catch {
      // Reported below; the edits stay so the user can fix and retry.
    }
  }

  return (
    <form
      className="notification-settings__form stack"
      aria-label="Notification settings"
      onSubmit={(event) => void onSubmit(event)}
    >
      <fieldset className="notification-settings__group">
        <legend>Channels</legend>
        <label className="notification-settings__check">
          <input
            type="checkbox"
            checked={inApp}
            onChange={(event) => setInApp(event.target.checked)}
          />
          In-app notifications
        </label>
        <label className="notification-settings__check">
          <input
            type="checkbox"
            checked={email}
            onChange={(event) => setEmail(event.target.checked)}
          />
          Email
        </label>
        <label className="notification-settings__check">
          <input type="checkbox" checked={false} disabled />
          Push (available once the app can be installed)
        </label>
      </fieldset>

      <fieldset className="notification-settings__group">
        <legend>Daily digest</legend>
        <label className="notification-settings__check">
          <input
            type="checkbox"
            checked={digestOn}
            onChange={(event) => setDigestOn(event.target.checked)}
          />
          Send a summary of Today each morning
        </label>
        <div className="task-detail__row">
          <Field label="Digest time" htmlFor={`${id}-digest`}>
            <TextInput
              id={`${id}-digest`}
              type="time"
              value={digestTime}
              disabled={!digestOn}
              onChange={(event) => setDigestTime(event.target.value)}
            />
          </Field>
          <Field
            label="Time zone"
            htmlFor={`${id}-timezone`}
            hint="Leave empty to use the workspace time zone."
          >
            <TextInput
              id={`${id}-timezone`}
              value={timezone}
              placeholder="Europe/Berlin"
              autoComplete="off"
              onChange={(event) => setTimezone(event.target.value)}
            />
          </Field>
        </div>
      </fieldset>

      <Field
        label="Default reminder for new timed tasks"
        htmlFor={`${id}-offset`}
        hint="Applied the first time a task gets a due time; each task can change it."
      >
        <Select
          id={`${id}-offset`}
          value={String(offset)}
          onChange={(event) => setOffset(Number(event.target.value))}
        >
          {REMINDER_OPTIONS.filter((option) => option.value !== null).map((option) => (
            <option key={option.value} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="button-row">
        <Button
          type="submit"
          variant="primary"
          loading={update.isPending}
          disabled={!dirty}
        >
          Save settings
        </Button>
        <output className="task-detail__hint" aria-live="polite">
          {saved && !dirty ? "Saved" : ""}
        </output>
      </div>
      {update.isError ? (
        <Alert tone="error" title="Settings could not be saved">
          {update.error instanceof Error
            ? update.error.message
            : "Something went wrong."}
        </Alert>
      ) : null}
    </form>
  );
}
