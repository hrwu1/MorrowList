"use client";

import type { UpcomingHorizon } from "@morrowlist/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";

export const upcomingKeys = {
  all: ["views", "upcoming"] as const,
  view: (horizon: UpcomingHorizon) => [...upcomingKeys.all, horizon] as const,
};

export function useUpcomingView(horizon: UpcomingHorizon) {
  return useQuery({
    queryKey: upcomingKeys.view(horizon),
    queryFn: () => apiClient.getUpcomingView({ horizon }),
  });
}
