import { sql } from "@/db";

export type OrgUsage = {
  projects: number;
  members: number;
  apiKeys: number;
  auditEvents: number;
};

export async function getOrgUsage(orgId: string): Promise<OrgUsage> {
  const rows = await sql`
    SELECT
      (SELECT count(*)::int FROM projects WHERE org_id = ${orgId}::uuid) AS projects,
      (SELECT count(*)::int FROM org_members WHERE org_id = ${orgId}::uuid) AS members,
      (SELECT count(*)::int FROM api_keys WHERE org_id = ${orgId}::uuid AND status = 'active') AS api_keys,
      (SELECT count(*)::int FROM audit_log WHERE org_id = ${orgId}::uuid) AS audit_events
  `;
  const row = rows[0] as {
    projects: number;
    members: number;
    api_keys: number;
    audit_events: number;
  };
  return {
    projects: row.projects,
    members: row.members,
    apiKeys: row.api_keys,
    auditEvents: row.audit_events,
  };
}
