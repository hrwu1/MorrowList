"use client";

import type { UpcomingHorizon } from "@morrowlist/contracts";
import { useQuery } from "@tanstack/react-query";

import { upcomingKeys } from "../lib/upcoming-keys";

import { apiClient } from "@/lib/api-client";

export { upcomingKeys } from "../lib/upcoming-keys";

export function useUpcomingView(horizon: UpcomingHorizon) {
  return useQuery({
    queryKey: upcomingKeys.view(horizon),
    queryFn: () => apiClient.getUpcomingView({ horizon }),
  });
}
