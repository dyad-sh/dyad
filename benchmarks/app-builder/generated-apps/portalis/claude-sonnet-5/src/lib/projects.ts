import { sql } from "@/db";

export interface Project {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export async function getProjects(orgId: string): Promise<Project[]> {
  const rows = await sql`
    SELECT id, org_id, name, description, created_at, updated_at
    FROM projects
    WHERE org_id = ${orgId}
    ORDER BY created_at ASC
  `;
  return rows as unknown as Project[];
}

export async function getProjectByIdInOrg(
  orgId: string,
  projectId: string,
): Promise<Project | undefined> {
  const rows = await sql`
    SELECT id, org_id, name, description, created_at, updated_at
    FROM projects
    WHERE id = ${projectId} AND org_id = ${orgId}
  `;
  return rows[0] as Project | undefined;
}
