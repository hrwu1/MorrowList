export const todayKeys = {
  all: ["views", "today"] as const,
  view: (date?: string | undefined) => [...todayKeys.all, date ?? "current"] as const,
};
