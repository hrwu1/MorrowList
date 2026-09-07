"use client";
import type { CreateRuleRequest, UpdateRuleRequest } from "@morrowlist/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";
export function useRules() {
  return useQuery({ queryKey: ["rules"], queryFn: () => apiClient.listRules() });
}
export function useRuleRuns(id: string | null) {
  return useQuery({
    queryKey: ["rules", "runs", id],
    queryFn: () => apiClient.listRuleRuns(id as string),
    enabled: id !== null,
    staleTime: 0,
    refetchInterval: 5_000,
  });
}
export function useRuleMutations() {
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: ["rules"] });
  return {
    create: useMutation({
      mutationFn: (body: CreateRuleRequest) => apiClient.createRule(body),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: string; body: UpdateRuleRequest }) =>
        apiClient.updateRule(id, body),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiClient.deleteRule(id),
      onSuccess: refresh,
    }),
    test: useMutation({
      mutationFn: ({ id, taskId }: { id: string; taskId: string }) =>
        apiClient.testRule(id, taskId),
    }),
  };
}
