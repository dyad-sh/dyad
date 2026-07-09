import { describe, expect, it } from "vitest";
import type { Incident } from "@/types/domain";
import { calculateIncidentRisk, isSlaBreached, summarizeIncidentLoad } from "./incidents";

const incident: Incident = {
  id: "inc-test",
  title: "Authentication outage",
  projectId: "proj-001",
  customerId: "cust-001",
  severity: "sev1",
  status: "investigating",
  openedAt: "2026-07-09T00:00:00Z",
  minutesOpen: 120,
  affectedUsers: 5000,
  owner: "Ari Lane",
  timeline: ["opened"],
};

describe("incident helpers", () => {
  it("calculates increasing risk for open severe incidents", () => {
    expect(calculateIncidentRisk(incident)).toBeGreaterThan(100);
  });

  it("detects SLA breaches by severity", () => {
    expect(isSlaBreached(incident)).toBe(true);
  });

  it("summarizes incident load", () => {
    expect(summarizeIncidentLoad([incident]).open).toBe(1);
  });
});
