import type { Incident, Severity } from "@/types/domain";

const severityWeights: Record<Severity, number> = {
  sev1: 100,
  sev2: 70,
  sev3: 35,
  sev4: 10,
};

export function getSeverityWeight(severity: Severity): number {
  return severityWeights[severity];
}

export function calculateIncidentRisk(incident: Incident): number {
  const ageMultiplier = Math.min(3, 1 + incident.minutesOpen / 240);
  const userMultiplier = Math.min(2.5, 1 + incident.affectedUsers / 10000);
  const stateMultiplier = incident.status === "resolved" ? 0.2 : incident.status === "monitoring" ? 0.65 : 1;
  return Math.round(getSeverityWeight(incident.severity) * ageMultiplier * userMultiplier * stateMultiplier);
}

export function isSlaBreached(incident: Incident): boolean {
  const thresholds: Record<Severity, number> = { sev1: 60, sev2: 180, sev3: 720, sev4: 1440 };
  return incident.status !== "resolved" && incident.minutesOpen > thresholds[incident.severity];
}

export function summarizeIncidentLoad(incidents: Incident[]) {
  const open = incidents.filter((incident) => incident.status !== "resolved");
  const breached = open.filter(isSlaBreached);
  return {
    total: incidents.length,
    open: open.length,
    breached: breached.length,
    risk: open.reduce((sum, incident) => sum + calculateIncidentRisk(incident), 0),
  };
}
