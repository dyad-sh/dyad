"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireOrgMember, requireUser } from "@/lib/organizations";

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function createOrganization(formData: FormData) {
  const user = await requireUser();
  const name = text(formData.get("name"));
  const slug = text(formData.get("slug")).toLowerCase();
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) redirect("/orgs/new?error=Please+enter+a+name+and+a+valid+lowercase+slug.");

  let organization: { id: string };
  try {
    const created = await sql`
      WITH new_organization AS (
        INSERT INTO organizations (name, slug) VALUES (${name}, ${slug}) RETURNING id
      ), new_membership AS (
        INSERT INTO organization_memberships (org_id, user_id, role)
        SELECT id, ${user.id}::uuid, 'org_admin' FROM new_organization
      ), audit AS (
        INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
        SELECT id, ${user.id}::uuid, ${user.email}, 'org.created', ${name} FROM new_organization
      )
      SELECT id FROM new_organization
    ` as unknown as { id: string }[];
    organization = created[0];
  } catch (caught) {
    const code = typeof caught === "object" && caught && "code" in caught ? String(caught.code) : "";
    if (code === "23505") redirect("/orgs/new?error=This+slug+is+already+in+use.");
    redirect("/orgs/new?error=Unable+to+create+organization.");
  }
  revalidatePath("/orgs");
  redirect(`/orgs/${organization.id}`);
}

export async function updateOrganization(orgId: string, formData: FormData) {
  const { organization, role, user } = await requireOrgMember(orgId);
  if (!organization || role !== "org_admin") redirect("/orgs");
  const name = text(formData.get("name"));
  const description = text(formData.get("description"));
  if (!name) redirect(`/orgs/${orgId}/settings?error=Organization+name+is+required.`);

  await sql`
    WITH updated AS (
      UPDATE organizations SET name = ${name}, description = ${description}, updated_at = now()
      WHERE id = ${orgId}::uuid RETURNING id
    ), audit AS (
      INSERT INTO organization_audit_logs (org_id, actor_user_id, actor_email, action, target)
      SELECT id, ${user.id}::uuid, ${user.email}, 'org.updated', ${name} FROM updated
    )
    SELECT id FROM updated
  `;
  revalidatePath("/orgs"); revalidatePath(`/orgs/${orgId}`); revalidatePath(`/orgs/${orgId}/settings`);
  redirect(`/orgs/${orgId}/settings?saved=1`);
}
