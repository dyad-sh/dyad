import { sql } from "@/db";

export type OrgUsage = {
  projectsCount: number;
  membersCount: number;
  apiKeysCount: number;
  eventsCount: number;
};

export async function getOrgUsage(orgId: string): Promise<OrgUsage> {
  const rows = await sql`
    SELECT
      (SELECT count(*)::int FROM projects WHERE org_id = ${orgId}) AS projects_count,
      (SELECT count(*)::int FROM organization_members WHERE org_id = ${orgId}) AS members_count,
      (SELECT count(*)::int FROM api_keys WHERE org_id = ${orgId} AND status = 'active') AS api_keys_count,
      (SELECT count(*)::int FROM audit_logs WHERE org_id = ${orgId}) AS events_count
  `;
  const row = rows[0] as {
    projects_count: number;
    members_count: number;
    api_keys_count: number;
    events_count: number;
  };

  return {
    projectsCount: Number(row.projects_count ?? 0),
    membersCount: Number(row.members_count ?? 0),
    apiKeysCount: Number(row.api_keys_count ?? 0),
    eventsCount: Number(row.events_count ?? 0),
  };
}
