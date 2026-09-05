"use client";

import { toLocalDate } from "@morrowlist/domain";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  readParsingPreference,
  subscribeToParsingPreference,
  writeParsingPreference,
  type NamedProject,
  type NamedTag,
} from "../lib/capture";

import { useProjects } from "@/features/projects/hooks/use-projects";
import { useTags } from "@/features/tags/hooks/use-tags";
import { localToday } from "@/features/today/lib/today-view";
import { useDefaultWorkspace } from "@/features/workspace/hooks/use-workspace";

/**
 * What quick add needs to read a line of text (GAP-15): the workspace's calendar date,
 * the names `#project` and `@tag` can resolve to, and this device's parsing preference.
 */

/**
 * On unless this device has turned it off. `useSyncExternalStore` keeps every open quick
 * add and the settings toggle in step, including across tabs.
 */
export function useParsingEnabled(): boolean {
  return useSyncExternalStore(
    subscribeToParsingPreference,
    readParsingPreference,
    () => true,
  );
}

export function useSetParsingEnabled(): (enabled: boolean) => void {
  return useCallback((enabled: boolean) => writeParsingPreference(enabled), []);
}

export interface CaptureNames {
  /** The workspace's calendar date (spec 12.3), or the browser's until `/me` answers. */
  readonly today: string;
  readonly projects: readonly NamedProject[];
  readonly tags: readonly NamedTag[];
}

export function useCaptureNames(): CaptureNames {
  const workspace = useDefaultWorkspace();
  const projects = useProjects();
  const tags = useTags();

  const timezone = workspace?.timezone;
  return useMemo(
    () => ({
      today: timezone ? toLocalDate(new Date(), timezone) : localToday(),
      projects: (projects.data?.data ?? []).map((project) => ({
        id: project.id,
        name: project.name,
      })),
      tags: (tags.data?.data ?? []).map((tag) => ({ id: tag.id, name: tag.name })),
    }),
    [timezone, projects.data, tags.data],
  );
}
