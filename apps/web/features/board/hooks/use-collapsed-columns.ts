"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-user collapsed columns, kept in `localStorage` (GAP-05): a personal view
 * preference, not project state, so it never touches the API or other members.
 */
export function useCollapsedColumns(projectId: string) {
  const storageKey = `morrowlist.board.${projectId}.collapsed`;
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);

  // Read after mount so the server-rendered board and the first client render agree.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      setCollapsed(
        Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [],
      );
    } catch {
      setCollapsed([]);
    }
  }, [storageKey]);

  const toggle = useCallback(
    (statusId: string) => {
      setCollapsed((current) => {
        const next = current.includes(statusId)
          ? current.filter((id) => id !== statusId)
          : [...current, statusId];
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Storage may be unavailable (private mode); the toggle still works for the session.
        }
        return next;
      });
    },
    [storageKey],
  );

  return { collapsed, toggle };
}
