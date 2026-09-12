export const workspaceKeys = {
  all: ["workspace"] as const,
  me: () => [...workspaceKeys.all, "me"] as const,
};
