import type { UpcomingHorizon } from "@morrowlist/contracts";

export const upcomingKeys = {
  all: ["views", "upcoming"] as const,
  view: (horizon: UpcomingHorizon) => [...upcomingKeys.all, horizon] as const,
};
