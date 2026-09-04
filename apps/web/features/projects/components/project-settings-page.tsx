"use client";

import { useDndMonitor, type DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type {
  ProjectDto,
  StatusCategory,
  TaskDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import {
  Alert,
  Button,
  Field,
  Select,
  Spinner,
  TextArea,
  TextInput,
} from "@morrowlist/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEventHandler,
} from "react";

import { useArchiveProject, useUpdateProject } from "../hooks/use-projects";
import {
  describeWorkflowError,
  useArchiveStatus,
  useCreateStatus,
  useReorderStatus,
  useUpdateStatus,
} from "../hooks/use-workflow";
import {
  CATEGORY_LABELS,
  STATUS_CATEGORY_OPTIONS,
  STATUS_COLOR_TOKENS,
  categoryChangeConsequence,
  placementForIndex,
} from "../lib/workflow-view";

import { useProjectBoard } from "@/features/board/hooks/use-board";

/** Drag data for a workflow row inside the workspace's one drag session. */
interface StatusDragData {
  readonly type: "workflow-status";
  readonly statusId: string;
}

function readStatusDrag(data: unknown): string | null {
  const candidate = data as Partial<StatusDragData> | undefined;
  return candidate?.type === "workflow-status" && candidate.statusId
    ? candidate.statusId
    : null;
}

/**
 * Project settings (GAP-05, spec 11): the project's own fields and its ordered
 * workflow. Every rule lives on the server; this page shows the consequence of a change
 * before it is saved and reports the server's answer when it refuses one.
 */
export function ProjectSettingsPage({ projectId }: { readonly projectId: string }) {
  const board = useProjectBoard(projectId);
  const reorderStatus = useReorderStatus(projectId);
  const [announcement, setAnnouncement] = useState("");

  const statuses = useMemo(
    () =>
      board.data?.data.statuses.filter((status) => status.archivedAt === null) ?? [],
    [board.data],
  );
  const tasks = board.data?.data.tasks ?? [];

  useDndMonitor({ onDragEnd });

  function moveStatus(status: WorkflowStatusDto, index: number) {
    const placement = placementForIndex(statuses, status.id, index);
    reorderStatus.mutate(
      { status, placement },
      {
        onSuccess: () =>
          setAnnouncement(`Moved ${status.name} to position ${index + 1}.`),
        onError: (error) =>
          setAnnouncement(
            `Could not move ${status.name}: ${describeWorkflowError(error)}`,
          ),
      },
    );
  }

  function onDragEnd(event: DragEndEvent) {
    const activeId = readStatusDrag(event.active.data.current);
    const overId = event.over ? readStatusDrag(event.over.data.current) : null;
    if (!activeId || !overId || activeId === overId) return;
    const status = statuses.find((candidate) => candidate.id === activeId);
    const overIndex = statuses.findIndex((candidate) => candidate.id === overId);
    if (!status || overIndex === -1) return;
    moveStatus(status, overIndex);
  }

  if (board.isPending) {
    return (
      <div className="settings-page board-page__status">
        <Spinner label="Loading project settings" />
      </div>
    );
  }

  if (board.isError) {
    return (
      <div className="settings-page">
        <Alert tone="error" title="This project could not be loaded">
          <p>
            {board.error instanceof Error
              ? board.error.message
              : "Something went wrong."}
          </p>
          <Button onClick={() => void board.refetch()}>Try again</Button>
        </Alert>
      </div>
    );
  }

  const project = board.data.data.project;

  return (
    <div className="settings-page stack">
      <header className="board-page__header">
        <div>
          <p className="board-page__eyebrow">Project settings</p>
          <h1>{project.name}</h1>
        </div>
        <Link
          className="ml-button ml-button--secondary"
          href={`/projects/${project.id}/board`}
        >
          Open board
        </Link>
      </header>

      <ProjectForm project={project} />

      <section aria-labelledby="workflow-heading" className="stack-tight">
        <h2 id="workflow-heading" className="section-heading">
          Workflow
        </h2>
        <p className="page-header__subtitle">
          Columns in board order. Drag a handle, or use Move up and Move down. Renaming
          a column never changes what it means; the category does.
        </p>
        {reorderStatus.isError ? (
          <Alert tone="error" title="The column could not be moved">
            {describeWorkflowError(reorderStatus.error)}
          </Alert>
        ) : null}
        <SortableContext
          items={statuses.map((status) => status.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="workflow-list" aria-label="Workflow columns">
            {statuses.map((status, index) => (
              <WorkflowRow
                key={`${status.id}-${status.version}`}
                status={status}
                index={index}
                count={statuses.length}
                statuses={statuses}
                tasks={tasks.filter((task) => task.statusId === status.id)}
                projectId={projectId}
                reordering={reorderStatus.isPending}
                onMove={moveStatus}
              />
            ))}
          </ol>
        </SortableContext>
        <AddColumnForm projectId={projectId} />
      </section>

      <output className="ml-visually-hidden" aria-live="polite">
        {announcement}
      </output>
    </div>
  );
}

function ProjectForm({ project }: { readonly project: ProjectDto }) {
  const router = useRouter();
  const update = useUpdateProject(project.id);
  const archive = useArchiveProject();
  const id = useId();
  const [name, setName] = useState(project.name);
  const [colorToken, setColorToken] = useState(project.colorToken);
  const [icon, setIcon] = useState(project.icon ?? "");
  const dirty =
    name.trim() !== project.name ||
    colorToken !== project.colorToken ||
    icon.trim() !== (project.icon ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || !name.trim()) return;
    update.mutate({
      name: name.trim(),
      colorToken,
      icon: icon.trim() ? icon.trim() : null,
      expectedVersion: project.version,
    });
  }

  async function archiveProject() {
    try {
      await archive.mutateAsync(project.id);
      router.push("/projects");
    } catch {
      // The error stays visible below.
    }
  }

  return (
    <form className="settings-form" aria-label="Project" onSubmit={submit}>
      <div className="settings-form__fields">
        <Field label="Project name" htmlFor={`${id}-name`}>
          <TextInput
            id={`${id}-name`}
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Colour" htmlFor={`${id}-color`}>
          <Select
            id={`${id}-color`}
            value={colorToken}
            onChange={(event) => setColorToken(event.target.value)}
          >
            {[...new Set([...STATUS_COLOR_TOKENS, project.colorToken])].map((token) => (
              <option key={token} value={token}>
                {token}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Icon" htmlFor={`${id}-icon`} hint="An emoji or a short icon name">
          <TextInput
            id={`${id}-icon`}
            value={icon}
            maxLength={80}
            onChange={(event) => setIcon(event.target.value)}
          />
        </Field>
      </div>
      {update.isError ? (
        <Alert tone="error" title="The project could not be saved">
          {describeWorkflowError(update.error)}
        </Alert>
      ) : null}
      {archive.isError ? (
        <Alert tone="error" title="The project could not be archived">
          {describeWorkflowError(archive.error)}
        </Alert>
      ) : null}
      <div className="button-row">
        <Button
          type="submit"
          variant="primary"
          loading={update.isPending}
          disabled={!dirty || !name.trim()}
        >
          Save project
        </Button>
        <span className="task-detail__save-state" role="status">
          {update.isSuccess && !dirty ? "Saved" : ""}
        </span>
        <span className="button-row__spacer" />
        <Button
          variant="danger"
          loading={archive.isPending}
          onClick={() => void archiveProject()}
        >
          Archive project
        </Button>
      </div>
    </form>
  );
}

function WorkflowRow({
  status,
  index,
  count,
  statuses,
  tasks,
  projectId,
  reordering,
  onMove,
}: {
  readonly status: WorkflowStatusDto;
  readonly index: number;
  readonly count: number;
  readonly statuses: readonly WorkflowStatusDto[];
  readonly tasks: readonly TaskDto[];
  readonly projectId: string;
  readonly reordering: boolean;
  readonly onMove: (status: WorkflowStatusDto, index: number) => void;
}) {
  const update = useUpdateStatus(projectId);
  const archive = useArchiveStatus(projectId);
  const id = useId();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: status.id,
      disabled: reordering,
      data: { type: "workflow-status", statusId: status.id } satisfies StatusDragData,
    });
  const style: CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  };

  const [name, setName] = useState(status.name);
  const [category, setCategory] = useState<StatusCategory>(status.category);
  const [colorToken, setColorToken] = useState(status.colorToken);
  const [wipLimit, setWipLimit] = useState(status.wipLimit?.toString() ?? "");
  const [policyMd, setPolicyMd] = useState(status.policyMd ?? "");
  const others = statuses.filter((candidate) => candidate.id !== status.id);
  const nonTerminalOthers = others.filter((candidate) => !candidate.isTerminal);
  const [destinationId, setDestinationId] = useState(others[0]?.id ?? "");
  const [newDefaultId, setNewDefaultId] = useState(nonTerminalOthers[0]?.id ?? "");

  const consequence = categoryChangeConsequence(
    status.category,
    category,
    tasks.length,
  );
  const dirty =
    name.trim() !== status.name ||
    category !== status.category ||
    colorToken !== status.colorToken ||
    (wipLimit.trim() ? Number(wipLimit) : null) !== status.wipLimit ||
    policyMd.trim() !== (status.policyMd ?? "");

  function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || !name.trim()) return;
    update.mutate({
      status,
      patch: {
        name: name.trim(),
        category,
        colorToken,
        wipLimit: wipLimit.trim() ? Number(wipLimit) : null,
        policyMd: policyMd.trim() ? policyMd.trim() : null,
      },
    });
  }

  function submitArchive(event: FormEvent) {
    event.preventDefault();
    archive.mutate({
      status,
      request: {
        destinationStatusId: tasks.length > 0 ? destinationId : null,
        newDefaultStatusId: status.isDefault ? newDefaultId || null : null,
      },
    });
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="workflow-row"
      data-dragging={isDragging || undefined}
      data-color={status.colorToken}
      aria-label={status.name}
    >
      <div className="workflow-row__order">
        <button
          type="button"
          className="board-card__drag"
          disabled={reordering}
          aria-label={`Drag ${status.name}. Press Space, then use arrow keys to move it.`}
          {...attributes}
          {...listeners}
          onKeyDown={
            listeners?.onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined
          }
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <Button
          variant="ghost"
          aria-label={`Move ${status.name} up`}
          disabled={reordering || index === 0}
          onClick={() => onMove(status, index - 1)}
        >
          ↑
        </Button>
        <Button
          variant="ghost"
          aria-label={`Move ${status.name} down`}
          disabled={reordering || index === count - 1}
          onClick={() => onMove(status, index + 1)}
        >
          ↓
        </Button>
      </div>

      <div className="workflow-row__body">
        <form
          className="stack-tight"
          aria-label={`Edit ${status.name}`}
          onSubmit={save}
        >
          <div className="workflow-row__fields">
            <Field label="Name" htmlFor={`${id}-name`}>
              <TextInput
                id={`${id}-name`}
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field
              label="Category"
              htmlFor={`${id}-category`}
              hint="Affects completion and reporting"
            >
              <Select
                id={`${id}-category`}
                value={category}
                onChange={(event) => setCategory(event.target.value as StatusCategory)}
              >
                {STATUS_CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {CATEGORY_LABELS[option]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Colour" htmlFor={`${id}-color`}>
              <Select
                id={`${id}-color`}
                value={colorToken}
                onChange={(event) => setColorToken(event.target.value)}
              >
                {[...new Set([...STATUS_COLOR_TOKENS, status.colorToken])].map(
                  (token) => (
                    <option key={token} value={token}>
                      {token}
                    </option>
                  ),
                )}
              </Select>
            </Field>
            <Field label="WIP limit" htmlFor={`${id}-wip`} hint="Blank for no limit">
              <TextInput
                id={`${id}-wip`}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={wipLimit}
                onChange={(event) => setWipLimit(event.target.value)}
              />
            </Field>
            <Field
              label="Policy"
              htmlFor={`${id}-policy`}
              hint="Definition of done or the rule for entering, in Markdown; shown from the column header"
            >
              <TextArea
                id={`${id}-policy`}
                rows={3}
                value={policyMd}
                maxLength={10_000}
                onChange={(event) => setPolicyMd(event.target.value)}
              />
            </Field>
          </div>
          {consequence ? (
            <p className="workflow-row__consequence" role="status">
              {consequence}
            </p>
          ) : null}
          {update.isError ? (
            <Alert tone="error" title="The column could not be saved">
              {describeWorkflowError(update.error)}
            </Alert>
          ) : null}
          <div className="button-row">
            <Button
              type="submit"
              variant="primary"
              loading={update.isPending}
              disabled={!dirty || !name.trim()}
            >
              Save column
            </Button>
            {status.isDefault ? (
              <span className="workflow-row__badge">Default for new tasks</span>
            ) : (
              <Button
                disabled={update.isPending || status.isTerminal}
                title={
                  status.isTerminal
                    ? "A Done column cannot receive new tasks"
                    : undefined
                }
                onClick={() => update.mutate({ status, patch: { isDefault: true } })}
              >
                Make default
              </Button>
            )}
            <span className="workflow-row__meta">
              {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
              {status.isTerminal ? " · marks work done" : ""}
            </span>
          </div>
        </form>

        <details className="workflow-row__archive">
          <summary>Archive {status.name}…</summary>
          <form
            className="workflow-row__archive-form"
            aria-label={`Archive ${status.name}`}
            onSubmit={submitArchive}
          >
            {tasks.length > 0 ? (
              <Field
                label={`Move ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} to`}
                htmlFor={`${id}-destination`}
              >
                <Select
                  id={`${id}-destination`}
                  value={destinationId}
                  onChange={(event) => setDestinationId(event.target.value)}
                >
                  {others.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {status.isDefault ? (
              <Field label="New default for new tasks" htmlFor={`${id}-new-default`}>
                <Select
                  id={`${id}-new-default`}
                  value={newDefaultId}
                  onChange={(event) => setNewDefaultId(event.target.value)}
                >
                  {nonTerminalOthers.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {archive.isError ? (
              <Alert tone="error" title="The column could not be archived">
                {describeWorkflowError(archive.error)}
              </Alert>
            ) : null}
            <div className="button-row">
              <Button type="submit" variant="danger" loading={archive.isPending}>
                Archive column
              </Button>
            </div>
          </form>
        </details>
      </div>
    </li>
  );
}

function AddColumnForm({ projectId }: { readonly projectId: string }) {
  const create = useCreateStatus(projectId);
  const id = useId();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<StatusCategory>("in_progress");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await create.mutateAsync({ name: name.trim(), category });
      setName("");
    } catch {
      // The error stays visible below and the name remains available to retry.
    }
  }

  return (
    <form className="settings-form" aria-label="Add a column" onSubmit={submit}>
      <div className="settings-form__fields">
        <Field label="New column name" htmlFor={`${id}-name`}>
          <TextInput
            id={`${id}-name`}
            value={name}
            maxLength={80}
            placeholder="For example, Testing"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Category" htmlFor={`${id}-category`}>
          <Select
            id={`${id}-category`}
            value={category}
            onChange={(event) => setCategory(event.target.value as StatusCategory)}
          >
            {STATUS_CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {CATEGORY_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {create.isError ? (
        <Alert tone="error" title="The column could not be added">
          {describeWorkflowError(create.error)}
        </Alert>
      ) : null}
      <div className="button-row">
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          disabled={!name.trim()}
        >
          Add column
        </Button>
      </div>
    </form>
  );
}
