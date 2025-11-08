import { useQuery } from "@tanstack/react-query";
import * as workflowsApi from "@/services/api/workflows";

export const workflowKeys = {
  all: ["workflows"] as const,
  ootb: () => [...workflowKeys.all, "ootb"] as const,
};

export function useOOTBWorkflows() {
  return useQuery({
    queryKey: workflowKeys.ootb(),
    queryFn: () => workflowsApi.listOOTBWorkflows(),
    staleTime: 5 * 60 * 1000, // 5 minutes - workflows don't change often
  });
}

