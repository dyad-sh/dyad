import { useState, useCallback } from "react";
import type { AgentConfig } from "@/types/agent-compute";

/**
 * Hook for deploying agent compute configurations.
 * Currently a stub — returns success for local testing.
 */
export function useAgentDeployment() {
  const [isDeploying, setIsDeploying] = useState(false);

  const deployAgent = useCallback(async (_config: AgentConfig) => {
    setIsDeploying(true);
    try {
      // Agent compute deployment is handled post-listing
      return { success: true, deploymentId: `agent-${Date.now()}` };
    } finally {
      setIsDeploying(false);
    }
  }, []);

  return { deployAgent, isDeploying };
}
