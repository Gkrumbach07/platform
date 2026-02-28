import { apiClient } from "./client";

export interface RunnerModel {
  value: string;
  label: string;
}

export interface RunnerType {
  id: string;
  displayName: string;
  description: string;
  defaultModel: string;
  models: RunnerModel[];
  requiredSecrets: string[];
}

export async function getRunnerTypes(): Promise<RunnerType[]> {
  return apiClient.get<RunnerType[]>("/runner-types");
}
