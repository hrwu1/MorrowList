"use client";

import type { TaskDto, WorkflowStatusDto } from "@morrowlist/contracts";
import { useEffect, useRef } from "react";

import { sortBoardTasks, type BoardSort } from "../lib/board-view";

import styles from "./project-studio.module.css";

import { TaskRow } from "@/features/tasks/components/task-row";

export interface ProjectStudioGroups {
  readonly motion: TaskDto[];
  readonly next: TaskDto[];
  readonly blocked: TaskDto[];
  readonly completed: TaskDto[];
}

/** Each projected task has one home; these same groups define selection order. */
export function groupProjectTasks(
  tasks: readonly TaskDto[],
  statuses: readonly WorkflowStatusDto[],
  sort: BoardSort,
): ProjectStudioGroups {
  const categories = new Map(statuses.map((status) => [status.id, status.category]));
  const groups: ProjectStudioGroups = {
    motion: [],
    next: [],
    blocked: [],
    completed: [],
  };

  for (const task of sortBoardTasks(tasks, sort)) {
    const category = task.statusId ? categories.get(task.statusId) : undefined;
    if (task.isCompleted) groups.completed.push(task);
    else if (task.isBlocked || category === "blocked") groups.blocked.push(task);
    else if (category === "in_progress" || category === "review")
      groups.motion.push(task);
    else groups.next.push(task);
  }

  return groups;
}

export function ProjectStudio({
  groups,
  statuses,
  selectedTaskKey,
  hrefForTask,
  moveDisabled,
  onMove,
}: {
  readonly groups: ProjectStudioGroups;
  readonly statuses: readonly WorkflowStatusDto[];
  readonly selectedTaskKey: string | null;
  readonly hrefForTask: (taskKey: string) => string;
  readonly moveDisabled: boolean;
  readonly onMove: (task: TaskDto, statusId: string) => void;
}) {
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    function releaseFocus(event: Event) {
      if (!pendingFocus.current || !(event.target instanceof Element)) return;
      if (event.target.closest("select")?.id === pendingFocus.current) return;
      // Disabling/remounting the select can temporarily leave focus on the body.
      if (event.type === "focusin" && event.target === document.body) return;
      pendingFocus.current = null;
    }
    document.addEventListener("focusin", releaseFocus);
    document.addEventListener("pointerdown", releaseFocus);
    return () => {
      document.removeEventListener("focusin", releaseFocus);
      document.removeEventListener("pointerdown", releaseFocus);
    };
  }, []);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id || moveDisabled) return;
    const control = document.getElementById(id);
    if (!control) return;
    if (
      document.activeElement === document.body ||
      document.activeElement === control
    ) {
      control.focus({ preventScroll: true });
    }
    pendingFocus.current = null;
  }, [groups, moveDisabled]);

  const sections = [
    { key: "motion", label: "In motion", count: groups.motion.length },
    { key: "next", label: "Up next", count: groups.next.length },
    { key: "blocked", label: "Needs a hand", count: groups.blocked.length },
    { key: "completed", label: "Completed", count: groups.completed.length },
  ] as const;

  function renderTask(task: TaskDto, featured = false) {
    return (
      <div
        key={task.id}
        className={featured ? styles.featuredTask : styles.taskEntry}
        data-selected={selectedTaskKey === task.key || undefined}
      >
        <label className={styles.stageLabel}>
          <span aria-hidden="true" className={styles.stageDot} />
          <select
            id={`studio-stage-${task.key}`}
            className={styles.stageSelect}
            aria-label={`Move ${task.title}`}
            value={task.statusId ?? ""}
            disabled={moveDisabled}
            onChange={(event) => {
              if (document.activeElement === event.currentTarget) {
                pendingFocus.current = event.currentTarget.id;
              }
              onMove(task, event.target.value);
            }}
          >
            {!statuses.some((status) => status.id === task.statusId) ? (
              <option value={task.statusId ?? ""} disabled>
                Unassigned stage
              </option>
            ) : null}
            {statuses.map((status) => (
              <option
                key={status.id}
                value={status.id}
                disabled={status.id === task.statusId}
              >
                {status.name}
              </option>
            ))}
          </select>
        </label>
        <ul className={styles.taskList}>
          <TaskRow
            task={task}
            detailHref={hrefForTask(task.key)}
            selected={selectedTaskKey === task.key}
          />
        </ul>
      </div>
    );
  }

  return (
    <div className={styles.studio}>
      <nav className={styles.pulse} aria-label="Project at a glance">
        {sections.map((section) => (
          <a key={section.key} href={`#studio-${section.key}`} data-kind={section.key}>
            <span className={styles.pulseCount}>{section.count}</span>
            <span className={styles.pulseLabel}>{section.label}</span>
            <span aria-hidden="true" className={styles.pulseArrow}>
              ↗
            </span>
          </a>
        ))}
      </nav>

      <section
        className={styles.section}
        id="studio-motion"
        aria-labelledby="studio-motion-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Keep the thread</p>
            <h2 id="studio-motion-title">
              In motion<span>{groups.motion.length}</span>
            </h2>
          </div>
          <p>Room to finish what you started.</p>
        </div>
        {groups.motion.length > 0 ? (
          <div className={styles.featuredGrid}>
            {groups.motion.map((task) => renderTask(task, true))}
          </div>
        ) : (
          <div className={styles.emptyMotion}>
            <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <path
                d="M15 44c8-16 24-23 34-24M20 46c3-12 10-20 23-26M22 37c-5-2-8-8-6-15 9 0 15 4 16 9M33 29c-1-9 4-17 15-19 3 10 0 18-9 22"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div>
              <h3>A little space to begin.</h3>
              <p>Choose an active stage from a task’s menu below when you’re ready.</p>
            </div>
          </div>
        )}
      </section>

      <section
        className={styles.section}
        id="studio-next"
        aria-labelledby="studio-next-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>One step at a time</p>
            <h2 id="studio-next-title">
              Up next<span>{groups.next.length}</span>
            </h2>
          </div>
          <p>Ready work and ideas for later.</p>
        </div>
        {groups.next.length > 0 ? (
          <div className={styles.rows}>
            {groups.next.map((task) => renderTask(task))}
          </div>
        ) : (
          <p className={styles.empty}>
            Nothing waiting here. Add a task whenever an idea arrives.
          </p>
        )}
      </section>

      <section
        className={styles.section}
        id="studio-blocked"
        aria-labelledby="studio-blocked-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Make a little room</p>
            <h2 id="studio-blocked-title">
              Needs a hand<span>{groups.blocked.length}</span>
            </h2>
          </div>
          <p>Blocked work, kept in sight.</p>
        </div>
        {groups.blocked.length > 0 ? (
          <div className={`${styles.rows} ${styles.blockedRows}`}>
            {groups.blocked.map((task) => renderTask(task))}
          </div>
        ) : (
          <p className={styles.empty}>No blocked work in this view.</p>
        )}
      </section>

      <section
        className={`${styles.section} ${styles.completedSection}`}
        id="studio-completed"
        aria-labelledby="studio-completed-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Look how far you’ve come</p>
            <h2 id="studio-completed-title">
              Completed<span>{groups.completed.length}</span>
            </h2>
          </div>
          <p>Every small finish counts.</p>
        </div>
        {groups.completed.length > 0 ? (
          <div className={styles.rows}>
            {groups.completed.map((task) => renderTask(task))}
          </div>
        ) : (
          <p className={styles.empty}>Your finished work will collect here.</p>
        )}
      </section>
    </div>
  );
}
