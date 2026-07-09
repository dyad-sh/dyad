import { describe, expect, it } from "vitest";
import type { Deployment } from "@/types/domain";
import { calculateDeploymentHealth, getFailedProductionDeployments, summarizeDeploymentStates } from "./deployments";

const deployments: Deployment[] = [
  { id: "dep-1", projectId: "proj-001", version: "v1.0.0", state: "passed", environment: "production", commit: "abc", author: "Ari", startedAt: "2026-07-09T00:00:00Z", durationMinutes: 8, checksPassed: 12, checksTotal: 12 },
  { id: "dep-2", projectId: "proj-001", version: "v1.0.1", state: "failed", environment: "production", commit: "def", author: "Bea", startedAt: "2026-07-09T01:00:00Z", durationMinutes: 4, checksPassed: 6, checksTotal: 12 },
];

describe("deployment helpers", () => {
  it("calculates deployment health", () => {
    expect(calculateDeploymentHealth(deployments)).toBeGreaterThan(0);
  });

  it("finds failed production deployments", () => {
    expect(getFailedProductionDeployments(deployments)).toHaveLength(1);
  });

  it("summarizes deployment states", () => {
    expect(summarizeDeploymentStates(deployments).passed).toBe(1);
  });
});
