import { sql, withTransaction } from "@/db";
import { insertAuditLog, type AuditActor } from "@/lib/audit";

export type Project = {
  id: string;
  org_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export async function listProjects(orgId: string): Promise<Project[]> {
  const rows = await sql`
    SELECT id, org_id, name, description, created_at, updated_at
    FROM projects
    WHERE org_id = ${orgId}
    ORDER BY name ASC
  `;
  return rows as Project[];
}

export async function getProjectInOrg(
  orgId: string,
  projectId: string,
): Promise<Project | null> {
  const rows = await sql`
    SELECT id, org_id, name, description, created_at, updated_at
    FROM projects
    WHERE id = ${projectId} AND org_id = ${orgId}
    LIMIT 1
  `;
  return (rows[0] as Project | undefined) ?? null;
}

export async function createProject(
  orgId: string,
  input: { name: string; description: string },
  actor: AuditActor,
): Promise<{ project?: Project; error?: string }> {
  const name = input.name.trim();
  const description = input.description.trim();

  if (!name) {
    return { error: "Project name is required." };
  }

  const project = await withTransaction(async (tx) => {
    const rows = await tx`
      INSERT INTO projects (org_id, name, description)
      VALUES (${orgId}, ${name}, ${description})
      RETURNING id, org_id, name, description, created_at, updated_at
    `;
    const created = rows[0] as Project;
    await insertAuditLog(tx, {
      orgId,
      actor,
      action: "project.created",
      target: created.id,
      metadata: { name: created.name },
    });
    return created;
  });

  return { project };
}

export async function updateProject(
  orgId: string,
  projectId: string,
  input: { name?: string; description?: string },
  actor: AuditActor,
): Promise<{ project?: Project; error?: string; notFound?: boolean }> {
  return withTransaction(async (tx) => {
    const existingRows = await tx`
      SELECT id, org_id, name, description, created_at, updated_at
      FROM projects
      WHERE id = ${projectId} AND org_id = ${orgId}
      LIMIT 1
    `;
    const existing = existingRows[0] as Project | undefined;
    if (!existing) {
      return { notFound: true };
    }

    const name =
      input.name !== undefined ? input.name.trim() : existing.name;
    const description =
      input.description !== undefined
        ? input.description.trim()
        : existing.description;

    if (!name) {
      return { error: "Project name is required." };
    }

    const rows = await tx`
      UPDATE projects
      SET
        name = ${name},
        description = ${description},
        updated_at = now()
      WHERE id = ${projectId} AND org_id = ${orgId}
      RETURNING id, org_id, name, description, created_at, updated_at
    `;

    if (!rows[0]) {
      return { notFound: true };
    }

    const project = rows[0] as Project;
    await insertAuditLog(tx, {
      orgId,
      actor,
      action: "project.updated",
      target: project.id,
      metadata: { name: project.name },
    });

    return { project };
  });
}

export async function deleteProject(
  orgId: string,
  projectId: string,
  actor: AuditActor,
): Promise<{ ok?: boolean; notFound?: boolean }> {
  return withTransaction(async (tx) => {
    const rows = await tx`
      DELETE FROM projects
      WHERE id = ${projectId} AND org_id = ${orgId}
      RETURNING id, name
    `;
    if (!rows[0]) {
      return { notFound: true };
    }

    const deleted = rows[0] as { id: string; name: string };
    await insertAuditLog(tx, {
      orgId,
      actor,
      action: "project.deleted",
      target: deleted.id,
      metadata: { name: deleted.name },
    });

    return { ok: true };
  });
}
