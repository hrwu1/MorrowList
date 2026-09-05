"use client";

import type {
  ExportActivityScope,
  ImportResultDto,
  ImportSource,
} from "@morrowlist/contracts";
import { Alert, Button, Field, Select, Spinner, TextInput } from "@morrowlist/ui";
import Link from "next/link";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";

import {
  exportTasksCsvHref,
  exportWorkspaceHref,
  useApplyImport,
  usePreviewImport,
} from "../hooks/use-data";
import {
  MAX_IMPORT_MB,
  SOURCE_ACCEPT,
  describeSampleTask,
  importButtonLabel,
  isTooLarge,
  previewCounts,
  sourceForFilename,
  sourceLabel,
} from "../lib/import-preview";

import { useDefaultWorkspace, useMe } from "@/features/workspace/hooks/use-workspace";

const ACTIVITY_LABELS: Record<ExportActivityScope, string> = {
  all: "All history",
  tasks: "Task history only",
  none: "No history (smallest file)",
};

/**
 * Settings › Data (spec 30, GAP-07): take everything out, or bring another tool's board
 * in. The import always previews first, because creating a project is not undoable.
 */
export function DataSettingsPage() {
  const me = useMe();
  const workspace = useDefaultWorkspace();

  const [activity, setActivity] = useState<ExportActivityScope>("all");
  const [source, setSource] = useState<ImportSource>("trello");
  const [fileName, setFileName] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportResultDto | null>(null);

  const preview = usePreviewImport();
  const apply = useApplyImport();
  const id = useId();

  if (me.isPending) {
    return (
      <div className="settings-page board-page__status">
        <Spinner label="Loading data settings" />
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

  function reset() {
    setFileName(null);
    setContent(null);
    setFileError(null);
    setImported(null);
    preview.reset();
    apply.reset();
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    reset();
    if (!file) return;
    if (isTooLarge(file.size)) {
      setFileError(`That file is larger than ${MAX_IMPORT_MB} MB.`);
      return;
    }

    const guessed = sourceForFilename(file.name);
    const chosen = guessed ?? source;
    setSource(chosen);
    setFileName(file.name);

    const text = await file.text();
    setContent(text);
    preview.mutate({
      source: chosen,
      content: text,
      ...(projectName.trim() ? { projectName: projectName.trim() } : {}),
    });
  }

  function onPreviewAgain(event: FormEvent) {
    event.preventDefault();
    if (!content) return;
    setImported(null);
    apply.reset();
    preview.mutate({
      source,
      content,
      ...(projectName.trim() ? { projectName: projectName.trim() } : {}),
    });
  }

  async function onImport() {
    if (!content) return;
    try {
      const result = await apply.mutateAsync({
        source,
        content,
        ...(projectName.trim() ? { projectName: projectName.trim() } : {}),
      });
      setImported(result);
    } catch {
      // The failure is rendered below; the file stays loaded so it can be retried.
    }
  }

  const plan = preview.data?.preview ?? null;

  return (
    <div className="settings-page stack">
      <header className="page-header">
        <h1>Data</h1>
        <p className="page-header__subtitle">
          Everything in {workspace.name} is yours to take out, and another tool&rsquo;s
          board is one file away from being a project here.
        </p>
      </header>

      <section className="settings-form" aria-labelledby={`${id}-export`}>
        <h2 className="section-heading" id={`${id}-export`}>
          Export
        </h2>
        <p className="page-header__subtitle">
          The archive is a versioned JSON file holding your projects, columns, tasks
          (trashed ones included), tags, relations, My Day history and saved views. No
          password, session or API key is ever exported.
        </p>
        <div className="settings-form__fields">
          <Field
            label="History in the archive"
            htmlFor={`${id}-activity`}
            hint="History is the biggest part of a large workspace."
          >
            <Select
              id={`${id}-activity`}
              value={activity}
              onChange={(event) =>
                setActivity(event.target.value as ExportActivityScope)
              }
            >
              {(Object.keys(ACTIVITY_LABELS) as ExportActivityScope[]).map((scope) => (
                <option key={scope} value={scope}>
                  {ACTIVITY_LABELS[scope]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="button-row">
          <a
            className="ml-button ml-button--primary"
            href={exportWorkspaceHref(workspace.id, activity)}
            download
            data-testid="export-archive"
          >
            Download archive (.json)
          </a>
          <a
            className="ml-button ml-button--secondary"
            href={exportTasksCsvHref(workspace.id)}
            download
            data-testid="export-csv"
          >
            Download tasks (.csv)
          </a>
        </div>
      </section>

      <section className="settings-form" aria-labelledby={`${id}-import`}>
        <h2 className="section-heading" id={`${id}-import`}>
          Import
        </h2>
        <p className="page-header__subtitle">
          A Trello board&rsquo;s JSON export, or a CSV with a <code>title</code> column.
          Lists become columns, labels become tags, and checklist items become subtasks.
          Nothing is written until you have seen the preview.
        </p>

        <form className="settings-form__fields" onSubmit={onPreviewAgain}>
          <Field
            label="Source"
            htmlFor={`${id}-source`}
            hint="Chosen from the file name when it is clear."
          >
            <Select
              id={`${id}-source`}
              value={source}
              onChange={(event) => {
                setSource(event.target.value as ImportSource);
                reset();
              }}
            >
              <option value="trello">Trello board (.json)</option>
              <option value="csv">CSV (.csv)</option>
            </Select>
          </Field>
          <Field
            label="File"
            htmlFor={`${id}-file`}
            hint={`At most ${MAX_IMPORT_MB} MB.`}
          >
            <input
              id={`${id}-file`}
              type="file"
              accept={SOURCE_ACCEPT[source]}
              onChange={(event) => void onFile(event)}
            />
          </Field>
          <Field
            label="Project name"
            htmlFor={`${id}-project`}
            hint="Blank uses the board's own name. The name must be free."
          >
            <TextInput
              id={`${id}-project`}
              value={projectName}
              placeholder="From the file"
              onChange={(event) => setProjectName(event.target.value)}
            />
          </Field>
        </form>

        {fileError ? (
          <Alert tone="error" title="That file cannot be imported">
            {fileError}
          </Alert>
        ) : null}
        {preview.isPending ? <Spinner label="Reading the file" /> : null}
        {preview.isError ? (
          <Alert tone="error" title={`This is not a ${sourceLabel(source)}`}>
            {preview.error.message}
          </Alert>
        ) : null}
        {apply.isError ? (
          <Alert tone="error" title="The import did not run">
            {apply.error.message}
          </Alert>
        ) : null}

        {imported ? (
          <Alert tone="success" title={`Imported ${imported.preview.projectName}`}>
            <Link href={`/projects/${imported.projectId}/board`}>
              Open the new board
            </Link>
          </Alert>
        ) : null}

        {plan && !imported ? (
          <div className="import-preview stack-tight" data-testid="import-preview">
            <h3>
              {plan.projectName}{" "}
              <span className="page-header__subtitle">
                from {fileName ?? sourceLabel(plan.source)}
              </span>
            </h3>
            <dl className="import-preview__counts">
              {previewCounts(plan).map((count) => (
                <div key={count.label}>
                  <dt>{count.label}</dt>
                  <dd>{count.value}</dd>
                </div>
              ))}
            </dl>

            {plan.statuses.length > 0 ? (
              <ul className="import-preview__columns">
                {plan.statuses.map((status) => (
                  <li key={status.name}>
                    <strong>{status.name}</strong>{" "}
                    <span className="page-header__subtitle">
                      {status.category.replace("_", " ")} · {status.taskCount} task
                      {status.taskCount === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {plan.tags.length > 0 ? (
              <p className="page-header__subtitle">Tags: {plan.tags.join(", ")}</p>
            ) : null}

            {plan.sample.length > 0 ? (
              <ul className="import-preview__sample">
                {plan.sample.map((task, index) => (
                  <li key={`${task.title}-${index}`}>
                    <strong>{task.title}</strong>{" "}
                    <span className="page-header__subtitle">
                      {describeSampleTask(task)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {plan.ignoredFields.length > 0 ? (
              <p className="page-header__subtitle">
                Not imported: {plan.ignoredFields.join(", ")}.
              </p>
            ) : null}

            {plan.issues.length > 0 ? (
              <Alert tone="warning" title={`${plan.issues.length} rows were skipped`}>
                <ul>
                  {plan.issues.slice(0, 10).map((issue) => (
                    <li key={`${issue.row}-${issue.reason}`}>
                      Row {issue.row}: {issue.title ?? "no title"} — {issue.reason}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            <div className="button-row">
              <Button
                variant="primary"
                loading={apply.isPending}
                onClick={() => void onImport()}
              >
                {importButtonLabel(plan)}
              </Button>
              <Button onClick={reset}>Cancel</Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
