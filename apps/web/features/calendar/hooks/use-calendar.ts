"use client";
import { useQuery } from "@tanstack/react-query";

import { calendarKeys } from "../lib/calendar-view";

import { apiClient } from "@/lib/api-client";
export function useCalendar(from: string, to: string) {
  return useQuery({
    queryKey: calendarKeys.view(from, to),
    queryFn: () => apiClient.getCalendarView({ from, to }),
  });
}
