"use client";

import { Alert, Button, Field, Spinner, TextInput } from "@morrowlist/ui";
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";

import { useDefaultWorkspace, useMe, useUpdateWorkspace } from "../hooks/use-workspace";
import { describeInProgress } from "../lib/wip";

import { describeWorkflowError } from "@/features/projects/hooks/use-workflow";
import {
  useParsingEnabled,
  useSetParsingEnabled,
} from "@/features/tasks/hooks/use-capture";

/**
 * Workspace settings: the one in-progress limit that spans every project (GAP-20), and
 * this device's capture preference (GAP-15).
 */
export function WorkspaceSettingsPage() {
  const me = useMe();
  const workspace = useDefaultWorkspace();
  const update = useUpdateWorkspace();
  const id = useId();
  const [limit, setLimit] = useState("");
  const parsingEnabled = useParsingEnabled();
  const setParsingEnabled = useSetParsingEnabled();

  useEffect(() => {
    setLimit(workspace?.inProgressLimit?.toString() ?? "");
  }, [workspace?.inProgressLimit]);

  if (me.isPending) {
    return (
      <div className="settings-page board-page__status">
        <Spinner label="Loading workspace settings" />
      </div>
    );
  }
  if (me.isError || !workspace) {
    return (
      <div className="settings-page">
        <Alert tone="error" title="Your workspace could not be loaded">
          <Button onClick={() => void me.refetch()}>Try again</Button>
        </Alert>
      </div>
    );
  }

  const requested = limit.trim() ? Number(limit) : null;
  const dirty = requested !== workspace.inProgressLimit;
  const summary = describeInProgress(
    workspace.inProgressCount,
    workspace.inProgressLimit,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || !workspace) return;
    update.mutate({
      workspaceId: workspace.id,
      request: { inProgressLimit: requested, expectedVersion: workspace.version },
    });
  }

  return (
    <div className="settings-page stack">
      <header className="page-header">
        <h1>Workspace</h1>
        <p className="page-header__subtitle">
          {workspace.name}. Settings that belong to you rather than to any one project.
        </p>
      </header>

      <form className="settings-form" aria-label="In-progress limit" onSubmit={submit}>
        <div className="settings-form__fields">
          <Field
            label="In-progress limit"
            htmlFor={`${id}-limit`}
            hint="How many tasks may be in progress across every project. Blank for no limit. Exceeding it warns; it never blocks a move."
          >
            <TextInput
              id={`${id}-limit`}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
            />
          </Field>
        </div>
        <p className="workspace-settings__count" data-tone={summary.tone}>
          Right now: {summary.label}.
        </p>
        {update.isError ? (
          <Alert tone="error" title="The limit could not be saved">
            {describeWorkflowError(update.error)}
          </Alert>
        ) : null}
        <div className="button-row">
          <Button
            type="submit"
            variant="primary"
            loading={update.isPending}
            disabled={!dirty}
          >
            Save limit
          </Button>
          <span className="task-detail__save-state" role="status">
            {update.isSuccess && !dirty ? "Saved" : ""}
          </span>
        </div>
      </form>

      {/* Reading what you type is a browser preference, not workspace data (GAP-15): it
          changes how this device captures, so it saves here and nowhere else. */}
      <section className="settings-form" aria-label="Quick add">
        <h2 className="section-heading">Quick add</h2>
        <label className="notification-settings__check">
          <input
            type="checkbox"
            checked={parsingEnabled}
            onChange={(event) => setParsingEnabled(event.target.checked)}
          />
          Read dates, priority, projects and tags out of what I type
        </label>
        <p className="page-header__subtitle">
          With this on, &ldquo;Call Sam tomorrow 5pm p1 #launch @phone&rdquo; fills
          those fields in, and a chip under the field says what it read before you press
          Enter. A backslash keeps one word literal, as in &ldquo;\#12&rdquo;. This
          setting is kept on this device.
        </p>
      </section>

      {/* Webhooks live behind this page rather than in the sidebar, which stays short
          enough to hold the places a person actually goes (spec 9). */}
      <section className="settings-form" aria-labelledby={`${id}-integrations`}>
        <h2 id={`${id}-integrations`}>Integrations</h2>
        <p className="task-detail__hint">
          Send every change in this workspace to an endpoint you control, signed so you
          can prove it came from MorrowList.
        </p>
        <p className="workspace-settings__link">
          <Link href="/settings/webhooks">Webhooks</Link>
          <Link href="/settings/rules">Automation rules</Link>
        </p>
      </section>

      <section className="settings-form" aria-label="Custom fields">
        <h2 className="task-detail__section-title">Custom fields</h2>
        <p className="page-header__subtitle">
          Up to ten typed slots on every task — a choice, a number, a date, a note.
        </p>
        <div className="button-row">
          <Link className="ml-button" href="/settings/fields">
            Manage fields
          </Link>
        </div>
      </section>
    </div>
  );
}
