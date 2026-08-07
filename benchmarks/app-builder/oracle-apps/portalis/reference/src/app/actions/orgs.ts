"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { sql } from "@/db";
import { auditInsert } from "@/lib/audit";
import { getSessionUser, getOrgForMember } from "@/lib/orgs";

export type ActionResult =
  | { ok: true; orgId?: string }
  | { ok: false; error: string };

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function createOrgAction(input: {
  name: string;
  slug: string;
}): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();

  if (!name) return { ok: false, error: "Name is required." };
  if (!slug) return { ok: false, error: "Slug is required." };
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      error: "Slug must be lowercase letters, numbers and dashes only.",
    };
  }

  const existing =
    await sql`SELECT id FROM organizations WHERE slug = ${slug} LIMIT 1`;
  if (existing.length > 0) {
    return { ok: false, error: "That slug is already taken." };
  }

  const orgId = randomUUID();

  try {
    await sql.transaction([
      sql`
        INSERT INTO organizations (id, name, slug)
        VALUES (${orgId}::uuid, ${name}, ${slug})
      `,
      sql`
        INSERT INTO org_members (org_id, user_id, email, name, role)
        VALUES (${orgId}::uuid, ${user.id}, ${user.email}, ${user.name}, 'org_admin')
      `,
      auditInsert({
        id: randomUUID(),
        orgId,
        actorUserId: user.id,
        actorEmail: user.email,
        action: "org.created",
        target: name,
        targetId: orgId,
      }),
    ]);
  } catch {
    return { ok: false, error: "That slug is already taken." };
  }

  revalidatePath("/orgs");
  return { ok: true, orgId };
}

export async function updateOrgAction(input: {
  orgId: string;
  name: string;
  description: string;
}): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You must be signed in." };

  const membership = await getOrgForMember(input.orgId, user.id);
  if (!membership) return { ok: false, error: "Not authorized." };
  if (membership.role !== "org_admin") {
    return { ok: false, error: "Only admins can edit organization settings." };
  }

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };

  const orgId = membership.org.id;

  await sql.transaction([
    sql`
      UPDATE organizations
      SET name = ${name}, description = ${input.description}, updated_at = now()
      WHERE id = ${orgId}::uuid
    `,
    auditInsert({
      id: randomUUID(),
      orgId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "org.updated",
      target: name,
      targetId: orgId,
    }),
  ]);

  revalidatePath("/orgs");
  revalidatePath(`/orgs/${orgId}`);
  revalidatePath(`/orgs/${orgId}/settings`);
  return { ok: true };
}
