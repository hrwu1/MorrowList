"use client";

import { Alert, Button, Field, Spinner, TextInput } from "@morrowlist/ui";
import { useEffect, useId, useState, type FormEvent } from "react";

import { useDefaultWorkspace, useMe, useUpdateWorkspace } from "../hooks/use-workspace";
import { describeInProgress } from "../lib/wip";

import { describeWorkflowError } from "@/features/projects/hooks/use-workflow";

/** Workspace settings (GAP-20): the one in-progress limit that spans every project. */
export function WorkspaceSettingsPage() {
  const me = useMe();
  const workspace = useDefaultWorkspace();
  const update = useUpdateWorkspace();
  const id = useId();
  const [limit, setLimit] = useState("");

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
    </div>
  );
}
