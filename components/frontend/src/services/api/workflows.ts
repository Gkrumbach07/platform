import { apiClient } from "./client";

export type OOTBWorkflow = {
  id: string;
  name: string;
  description: string;
  gitUrl: string;
  branch: string;
  path?: string;
  enabled: boolean;
};

export type ListOOTBWorkflowsResponse = {
  workflows: OOTBWorkflow[];
};

export async function listOOTBWorkflows(): Promise<OOTBWorkflow[]> {
  const response = await apiClient.get<ListOOTBWorkflowsResponse>("/workflows/ootb");
  return response.workflows;
}

