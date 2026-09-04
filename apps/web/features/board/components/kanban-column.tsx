"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type {
  ArchiveStatusRequest,
  TaskDto,
  UpdateStatusRequest,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import { Alert, Button, Select, TextArea, TextInput } from "@morrowlist/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { KanbanCard } from "./kanban-card";

import { STATUS_COLOR_TOKENS } from "@/features/projects/lib/workflow-view";
import { Markdown } from "@/features/tasks/components/markdown";

/** Column edits the board can make in place; the settings page owns the rest. */
export interface ColumnEditing {
  readonly busy: boolean;
  /** The failure of the last edit, attributed to the column it was made on. */
  readonly error: { readonly statusId: string; readonly message: string } | null;
  readonly onUpdate: (
    status: WorkflowStatusDto,
    patch: Omit<UpdateStatusRequest, "expectedVersion">,
  ) => void;
  readonly onArchive: (
    status: WorkflowStatusDto,
    request: Omit<ArchiveStatusRequest, "expectedVersion">,
  ) => void;
}

export interface KanbanColumnProps {
  readonly status: WorkflowStatusDto;
  readonly tasks: readonly TaskDto[];
  readonly statuses: readonly WorkflowStatusDto[];
  readonly selectedTaskKey: string | null;
  readonly mobileActive: boolean;
  /** No card may start a drag (a move is in flight). */
  readonly dragDisabled: boolean;
  /** Columns accept no drops (automatic sort); cards can still be dragged to the sidebar. */
  readonly reorderDisabled: boolean;
  readonly moveDisabled: boolean;
  readonly collapsed: boolean;
  readonly showAge: boolean;
  /** "Usually done in N days", from the project's 85th percentile cycle time (GAP-17). */
  readonly hint: string | null;
  readonly hrefForTask: (taskKey: string) => string;
  readonly onMove: (task: TaskDto, statusId: string) => void;
  readonly onToggleCollapse: (statusId: string) => void;
  readonly editing: ColumnEditing;
}

export function KanbanColumn({
  status,
  tasks,
  statuses,
  selectedTaskKey,
  mobileActive,
  dragDisabled,
  reorderDisabled,
  moveDisabled,
  collapsed,
  showAge,
  hint,
  hrefForTask,
  onMove,
  onToggleCollapse,
  editing,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `status:${status.id}`,
    disabled: reorderDisabled,
    data: { type: "status", statusId: status.id },
  });
  const [renaming, setRenaming] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const overLimit = status.wipLimit !== null && tasks.length > status.wipLimit;
  const atLimit = status.wipLimit !== null && tasks.length === status.wipLimit;
  const exceptionStage = status.category === "blocked" || status.category === "review";
  const error = editing.error?.statusId === status.id ? editing.error.message : null;

  return (
    <section
      ref={setNodeRef}
      className="kanban-column"
      data-category={status.category}
      data-color={status.colorToken}
      data-core-stage={!exceptionStage || undefined}
      data-exception-stage={exceptionStage || undefined}
      data-revealed={exceptionStage || undefined}
      data-occupied={tasks.length > 0 || undefined}
      data-drop-target={isOver || undefined}
      data-wip-over={overLimit || undefined}
      data-mobile-active={mobileActive || undefined}
      data-collapsed={collapsed || undefined}
      aria-labelledby={`board-status-${status.id}`}
    >
      {collapsed ? (
        <header className="kanban-column__header kanban-column__header--collapsed">
          <button
            type="button"
            className="kanban-column__expand"
            aria-label={`Expand ${status.name}`}
            title="Expand column"
            onClick={() => onToggleCollapse(status.id)}
          >
            <span aria-hidden="true">›</span>
          </button>
          <span className="kanban-column__dot" aria-hidden="true" />
          <h2
            id={`board-status-${status.id}`}
            className="kanban-column__collapsed-name"
          >
            {status.name}
          </h2>
          <span className="kanban-column__count" aria-label={`${tasks.length} tasks`}>
            {tasks.length}
          </span>
        </header>
      ) : (
        <header className="kanban-column__header">
          <div className="kanban-column__heading">
            <span className="kanban-column__dot" aria-hidden="true" />
            {renaming ? (
              <RenameForm
                status={status}
                busy={editing.busy}
                onCancel={() => setRenaming(false)}
                onSubmit={(name) => {
                  setRenaming(false);
                  if (name !== status.name) editing.onUpdate(status, { name });
                }}
              />
            ) : (
              <h2 id={`board-status-${status.id}`}>{status.name}</h2>
            )}
            <span className="kanban-column__count" aria-label={`${tasks.length} tasks`}>
              {tasks.length}
            </span>
            {status.policyMd ? (
              <button
                type="button"
                className="kanban-column__policy-toggle"
                aria-label={`Show policy for ${status.name}`}
                aria-expanded={policyOpen}
                aria-controls={`board-policy-${status.id}`}
                title={status.policyMd}
                onClick={() => setPolicyOpen((open) => !open)}
              >
                <span aria-hidden="true">i</span>
              </button>
            ) : null}
            <ColumnMenu
              status={status}
              statuses={statuses}
              taskCount={tasks.length}
              editing={editing}
              onRename={() => setRenaming(true)}
              onCollapse={() => onToggleCollapse(status.id)}
            />
          </div>
          {status.category === "blocked" ? (
            // The column stays a view (spec 9.5); the flag is the preferred signal.
            <p className="kanban-column__hint">
              Prefer marking a task blocked with a reason: it keeps its stage and says
              why.
            </p>
          ) : null}
          {status.wipLimit !== null ? (
            <span
              className="kanban-column__wip"
              data-state={overLimit ? "over" : atLimit ? "at" : undefined}
            >
              {tasks.length} / {status.wipLimit} WIP
              {overLimit ? " · over limit" : atLimit ? " · at limit" : ""}
            </span>
          ) : null}
          {hint ? <span className="kanban-column__forecast">{hint}</span> : null}
          {status.policyMd && policyOpen ? (
            <div
              id={`board-policy-${status.id}`}
              className="kanban-column__policy"
              aria-label={`Policy for ${status.name}`}
            >
              <Markdown source={status.policyMd} />
            </div>
          ) : null}
          {error ? (
            <div className="kanban-column__error">
              <Alert tone="error">{error}</Alert>
            </div>
          ) : null}
        </header>
      )}

      {collapsed ? null : (
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="kanban-column__tasks" aria-label={`${status.name} tasks`}>
            {tasks.length === 0 ? (
              <li className="kanban-column__empty">Drop a task here</li>
            ) : (
              tasks.map((task) => (
                <KanbanCard
                  key={task.id}
                  task={task}
                  statuses={statuses}
                  detailHref={hrefForTask(task.key)}
                  selected={task.key === selectedTaskKey}
                  dragDisabled={dragDisabled}
                  reorderDisabled={reorderDisabled}
                  moveDisabled={moveDisabled}
                  showAge={showAge}
                  onMove={onMove}
                />
              ))
            )}
          </ul>
        </SortableContext>
      )}
    </section>
  );
}

/** Inline rename in the column heading: Enter saves, Escape cancels. */
function RenameForm({
  status,
  busy,
  onCancel,
  onSubmit,
}: {
  readonly status: WorkflowStatusDto;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(status.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }

  return (
    <form
      className="kanban-column__rename"
      aria-label={`Rename ${status.name}`}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onCancel();
      }}
    >
      <TextInput
        ref={inputRef}
        aria-label="Column name"
        value={name}
        maxLength={80}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        onBlur={onCancel}
      />
      <Button
        type="submit"
        variant="primary"
        disabled={!name.trim() || busy}
        // Pressed before the input's blur cancels the edit.
        onPointerDown={(event) => event.preventDefault()}
      >
        Save
      </Button>
    </form>
  );
}

function ColumnMenu({
  status,
  statuses,
  taskCount,
  editing,
  onRename,
  onCollapse,
}: {
  readonly status: WorkflowStatusDto;
  readonly statuses: readonly WorkflowStatusDto[];
  readonly taskCount: number;
  readonly editing: ColumnEditing;
  readonly onRename: () => void;
  readonly onCollapse: () => void;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [wipLimit, setWipLimit] = useState(status.wipLimit?.toString() ?? "");
  const [policyMd, setPolicyMd] = useState(status.policyMd ?? "");
  const others = statuses.filter((candidate) => candidate.id !== status.id);
  const [destinationId, setDestinationId] = useState(others[0]?.id ?? "");
  const nonTerminalOthers = others.filter((candidate) => !candidate.isTerminal);
  const [newDefaultId, setNewDefaultId] = useState(nonTerminalOthers[0]?.id ?? "");

  useEffect(() => {
    setWipLimit(status.wipLimit?.toString() ?? "");
  }, [status.wipLimit]);
  useEffect(() => {
    setPolicyMd(status.policyMd ?? "");
  }, [status.policyMd]);

  function close() {
    menuRef.current?.removeAttribute("open");
  }

  function submitWip(event: FormEvent) {
    event.preventDefault();
    const trimmed = wipLimit.trim();
    editing.onUpdate(status, { wipLimit: trimmed ? Number(trimmed) : null });
  }

  function submitPolicy(event: FormEvent) {
    event.preventDefault();
    const trimmed = policyMd.trim();
    if (trimmed === (status.policyMd ?? "")) return;
    editing.onUpdate(status, { policyMd: trimmed ? trimmed : null });
    // The policy is read from the header glyph, so the menu gets out of its way.
    close();
  }

  function submitArchive(event: FormEvent) {
    event.preventDefault();
    editing.onArchive(status, {
      destinationStatusId: taskCount > 0 ? destinationId : null,
      newDefaultStatusId: status.isDefault ? newDefaultId || null : null,
    });
  }

  return (
    <details
      ref={menuRef}
      className="kanban-column__menu"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close();
        menuRef.current?.querySelector("summary")?.focus();
      }}
    >
      <summary aria-label={`Options for ${status.name}`} title="Column options">
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="kanban-column__menu-panel">
        <div className="button-row">
          <Button
            onClick={() => {
              close();
              onRename();
            }}
          >
            Rename
          </Button>
          <Button
            onClick={() => {
              close();
              onCollapse();
            }}
          >
            Collapse
          </Button>
        </div>

        <label className="filters__control">
          <span className="ml-field__label">Colour</span>
          <Select
            value={status.colorToken}
            disabled={editing.busy}
            onChange={(event) =>
              editing.onUpdate(status, { colorToken: event.target.value })
            }
          >
            {[...new Set([...STATUS_COLOR_TOKENS, status.colorToken])].map((token) => (
              <option key={token} value={token}>
                {token}
              </option>
            ))}
          </Select>
        </label>

        <form
          className="kanban-column__menu-form"
          aria-label={`WIP limit for ${status.name}`}
          onSubmit={submitWip}
        >
          <label className="filters__control">
            <span className="ml-field__label">WIP limit</span>
            <TextInput
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              placeholder="None"
              value={wipLimit}
              disabled={editing.busy}
              onChange={(event) => setWipLimit(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={editing.busy}>
            Set limit
          </Button>
        </form>

        <form
          className="kanban-column__menu-form"
          aria-label={`Edit policy for ${status.name}`}
          onSubmit={submitPolicy}
        >
          <label className="filters__control">
            <span className="ml-field__label">Policy</span>
            <TextArea
              rows={3}
              maxLength={10_000}
              placeholder="Definition of done, or the rule for entering. Markdown."
              value={policyMd}
              disabled={editing.busy}
              onChange={(event) => setPolicyMd(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={editing.busy}>
            Save policy
          </Button>
        </form>

        {status.isDefault ? (
          <p className="kanban-column__menu-note">Default for new tasks</p>
        ) : (
          <Button
            disabled={editing.busy || status.isTerminal}
            title={
              status.isTerminal ? "A Done column cannot receive new tasks" : undefined
            }
            onClick={() => editing.onUpdate(status, { isDefault: true })}
          >
            Make default for new tasks
          </Button>
        )}

        <form
          className="kanban-column__menu-form kanban-column__menu-form--archive"
          aria-label={`Archive ${status.name}`}
          onSubmit={submitArchive}
        >
          {taskCount > 0 ? (
            <label className="filters__control">
              <span className="ml-field__label">
                Move {taskCount} {taskCount === 1 ? "task" : "tasks"} to
              </span>
              <Select
                value={destinationId}
                disabled={editing.busy}
                onChange={(event) => setDestinationId(event.target.value)}
              >
                {others.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          {status.isDefault ? (
            <label className="filters__control">
              <span className="ml-field__label">New default for new tasks</span>
              <Select
                value={newDefaultId}
                disabled={editing.busy}
                onChange={(event) => setNewDefaultId(event.target.value)}
              >
                {nonTerminalOthers.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <Button type="submit" variant="danger" disabled={editing.busy}>
            Archive column
          </Button>
        </form>
      </div>
    </details>
  );
}
