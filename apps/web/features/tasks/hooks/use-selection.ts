"use client";

import type { TaskDto } from "@morrowlist/contracts";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  EMPTY_SELECTION,
  extendTo,
  isSelected,
  retain,
  selectAll,
  selectedTasks,
  toggle,
  type Selection,
} from "../lib/selection";

/**
 * Selection as context rather than props (GAP-08).
 *
 * A row and a board card are rendered several layers below the screen that owns the
 * selection, and neither of them decides anything about it. Passing the state down would
 * mean threading it through every list, column, and section; reading it here keeps the
 * checkbox a local detail. Outside a provider the context is disabled and no checkbox is
 * rendered at all, so Today, Upcoming, and the search results are untouched.
 */

export interface SelectionState {
  readonly enabled: boolean;
  readonly selected: readonly string[];
  readonly count: number;
  readonly isSelected: (id: string) => boolean;
  /** `range` is a Shift-click: extend from the anchor instead of toggling one row. */
  readonly toggle: (id: string, options?: { readonly range?: boolean }) => void;
  readonly toggleAll: () => void;
  readonly clear: () => void;
  readonly tasksIn: (tasks: readonly TaskDto[]) => readonly TaskDto[];
}

const DISABLED: SelectionState = {
  enabled: false,
  selected: [],
  count: 0,
  isSelected: () => false,
  toggle: () => {},
  toggleAll: () => {},
  clear: () => {},
  tasksIn: () => [],
};

export const SelectionContext = createContext<SelectionState>(DISABLED);

export function useSelection(): SelectionState {
  return useContext(SelectionContext);
}

/** The state a `SelectionProvider` owns; `order` is what is on screen, top to bottom. */
export function useSelectionState(order: readonly string[]): SelectionState {
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);

  // Rows a bulk change removed from the list stop being selected; anything else would
  // leave the toolbar offering to act on tasks that are no longer there.
  useEffect(() => {
    setSelection((current) => retain(current, order));
  }, [order]);

  return useMemo(
    () => ({
      enabled: true,
      selected: selection.ids,
      count: selection.ids.length,
      isSelected: (id: string) => isSelected(selection, id),
      toggle: (id: string, options: { readonly range?: boolean } = {}) =>
        setSelection((current) =>
          options.range ? extendTo(current, id, order) : toggle(current, id),
        ),
      toggleAll: () => setSelection((current) => selectAll(current, order)),
      clear: () => setSelection(EMPTY_SELECTION),
      tasksIn: (tasks: readonly TaskDto[]) => selectedTasks(selection, tasks),
    }),
    [order, selection],
  );
}
