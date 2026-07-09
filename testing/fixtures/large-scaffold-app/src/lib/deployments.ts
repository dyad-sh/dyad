import type { Deployment } from "@/types/domain";

export function calculateDeploymentHealth(deployments: Deployment[]): number {
  if (deployments.length === 0) return 100;
  const score = deployments.reduce((sum, deployment) => {
    const checkScore = deployment.checksPassed / deployment.checksTotal;
    const stateScore = deployment.state === "passed" ? 1 : deployment.state === "running" ? 0.72 : deployment.state === "queued" ? 0.55 : 0.2;
    return sum + checkScore * stateScore * 100;
  }, 0);
  return Math.round(score / deployments.length);
}

export function getFailedProductionDeployments(deployments: Deployment[]): Deployment[] {
  return deployments.filter((deployment) => deployment.environment === "production" && (deployment.state === "failed" || deployment.state === "rolled_back"));
}

export function summarizeDeploymentStates(deployments: Deployment[]) {
  return deployments.reduce<Record<string, number>>((summary, deployment) => {
    summary[deployment.state] = (summary[deployment.state] ?? 0) + 1;
    return summary;
  }, {});
}
