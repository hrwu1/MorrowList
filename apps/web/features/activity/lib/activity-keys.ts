export const activityKeys = {
  all: ["activity"] as const,
  task: (idOrKey: string) => [...activityKeys.all, "task", idOrKey] as const,
  project: (projectId: string) => [...activityKeys.all, "project", projectId] as const,
};
