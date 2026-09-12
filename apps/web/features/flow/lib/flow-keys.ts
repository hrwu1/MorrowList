import type { FlowRange } from "@morrowlist/contracts";

export const flowKeys = {
  all: ["flow"] as const,
  project: (projectId: string, range: FlowRange) =>
    [...flowKeys.all, "project", projectId, range] as const,
};
