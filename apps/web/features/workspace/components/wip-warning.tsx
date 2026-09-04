"use client";

import type { WipWarningDto } from "@morrowlist/contracts";
import { Alert, Button } from "@morrowlist/ui";
import { useState } from "react";

import { useMoveTaskToReady } from "@/features/tasks/hooks/use-tasks";

/**
 * The cross-project limit was exceeded by a move (GAP-20). The move already happened;
 * this lists everything currently started so one of them can go back to Ready.
 */
export function WipWarning({
  warning,
  onDismiss,
}: {
  readonly warning: WipWarningDto;
  readonly onDismiss: () => void;
}) {
  const moveToReady = useMoveTaskToReady();
  const [movedIds, setMovedIds] = useState<readonly string[]>([]);
  const remaining = warning.tasks.filter((task) => !movedIds.includes(task.id));

  return (
    <Alert tone="warning" title="Over your in-progress limit">
      <p>{warning.message}</p>
      <ul className="wip-warning__tasks" aria-label="Tasks in progress">
        {remaining.map((task) => {
          const busy =
            moveToReady.isPending && moveToReady.variables?.taskId === task.id;
          return (
            <li key={task.id}>
              <span className="task-row__key">{task.key}</span>
              <span>{task.title}</span>
              {task.projectId ? (
                <Button
                  variant="ghost"
                  loading={busy}
                  disabled={moveToReady.isPending}
                  aria-label={`Move ${task.title} to Ready`}
                  onClick={() =>
                    moveToReady.mutate(
                      { taskId: task.id, projectId: task.projectId as string },
                      { onSuccess: () => setMovedIds((ids) => [...ids, task.id]) },
                    )
                  }
                >
                  Move to Ready
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {moveToReady.isError ? (
        <p className="wip-warning__error">
          That task could not be moved. It is still in progress.
        </p>
      ) : null}
      <div className="button-row">
        <Button onClick={onDismiss}>Dismiss</Button>
      </div>
    </Alert>
  );
}
