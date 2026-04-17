export interface AgentConfig {
  computeType: "cpu" | "gpu" | "serverless";
  cpuCores: number;
  memoryGB: number;
  gpuType?: string;
  modelId?: string;
  entrypoint: string;
}

export const DEFAULT_COMPUTE_CONFIG = {
  computeType: "cpu" as const,
  cpuCores: 2,
  memoryGB: 4,
  gpuType: "none",
  modelId: "",
  entrypoint: "main.py",
};
