import type { AppSettings } from "@/types/domain";

export const appSettings: AppSettings = {
  workspaceName: "Northstar Operations",
  auditRetentionDays: 180,
  deploymentFreeze: false,
  incidentDigestHour: 9,
  defaultRegion: "us-east-1",
};
