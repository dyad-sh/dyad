import { sql } from "@/db";

export interface OrgUsage {
  projects: number;
  members: number;
  apiKeys: number;
  auditEvents: number;
}

export async function getOrgUsage(orgId: string): Promise<OrgUsage> {
  const [[projects], [members], [apiKeys], [auditEvents]] = await Promise.all([
    sql`SELECT count(*)::int AS count FROM projects WHERE org_id = ${orgId}`,
    sql`SELECT count(*)::int AS count FROM org_members WHERE org_id = ${orgId}`,
    sql`SELECT count(*)::int AS count FROM api_keys WHERE org_id = ${orgId} AND status = 'active'`,
    sql`SELECT count(*)::int AS count FROM audit_log WHERE org_id = ${orgId}`,
  ]);

  return {
    projects: (projects as { count: number }).count,
    members: (members as { count: number }).count,
    apiKeys: (apiKeys as { count: number }).count,
    auditEvents: (auditEvents as { count: number }).count,
  };
}
