export type Status = "healthy" | "watch" | "risk" | "blocked";
export type Severity = "sev1" | "sev2" | "sev3" | "sev4";
export type DeploymentState = "queued" | "running" | "passed" | "failed" | "rolled_back";

export interface Project {
  id: string;
  name: string;
  owner: string;
  customerId: string;
  status: Status;
  region: string;
  tier: "starter" | "growth" | "enterprise";
  budget: number;
  healthScore: number;
  openIncidents: number;
  deploymentsThisWeek: number;
  tags: string[];
  summary: string;
}

export interface Customer {
  id: string;
  name: string;
  segment: "commercial" | "strategic" | "public_sector";
  accountOwner: string;
  renewalDate: string;
  arr: number;
  satisfaction: number;
  primaryRegion: string;
  activeProjects: number;
  riskNotes: string[];
}

export interface Incident {
  id: string;
  title: string;
  projectId: string;
  customerId: string;
  severity: Severity;
  status: "investigating" | "mitigating" | "monitoring" | "resolved";
  openedAt: string;
  minutesOpen: number;
  affectedUsers: number;
  owner: string;
  timeline: string[];
}

export interface Deployment {
  id: string;
  projectId: string;
  version: string;
  state: DeploymentState;
  environment: "preview" | "staging" | "production";
  commit: string;
  author: string;
  startedAt: string;
  durationMinutes: number;
  checksPassed: number;
  checksTotal: number;
}

export interface Automation {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  runsToday: number;
  successRate: number;
  owner: string;
  lastRunAt: string;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  collection: string;
  updatedAt: string;
  views: number;
  helpfulVotes: number;
  tags: string[];
}

export interface ReportMetric {
  id: string;
  label: string;
  value: number;
  previousValue: number;
  unit: "count" | "percent" | "currency" | "minutes";
  trend: "up" | "down" | "flat";
}

export interface AppSettings {
  workspaceName: string;
  auditRetentionDays: number;
  deploymentFreeze: boolean;
  incidentDigestHour: number;
  defaultRegion: string;
}
