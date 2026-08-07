import { sql, type Company, type ContactWithCompany } from "@/db";

/* ---------------------------------- companies --------------------------------- */

export async function listCompanies(workspaceId: string): Promise<Company[]> {
  return (await sql`
    SELECT * FROM companies WHERE workspace_id = ${workspaceId} ORDER BY name ASC
  `) as Company[];
}

export async function getCompany(
  workspaceId: string,
  id: string,
): Promise<Company | null> {
  const rows = (await sql`
    SELECT * FROM companies WHERE id = ${id} AND workspace_id = ${workspaceId}
  `) as Company[];
  return rows[0] ?? null;
}

export async function createCompany(
  workspaceId: string,
  userId: string,
  data: { name: string; domain?: string | null },
): Promise<Company> {
  const rows = (await sql`
    INSERT INTO companies (workspace_id, user_id, name, domain)
    VALUES (${workspaceId}, ${userId}, ${data.name}, ${data.domain ?? null})
    RETURNING *
  `) as Company[];
  return rows[0];
}

export async function updateCompany(
  workspaceId: string,
  id: string,
  data: { name?: string; domain?: string | null },
): Promise<Company | null> {
  const existing = await getCompany(workspaceId, id);
  if (!existing) return null;
  const rows = (await sql`
    UPDATE companies SET
      name = ${data.name ?? existing.name},
      domain = ${data.domain === undefined ? existing.domain : data.domain}
    WHERE id = ${id} AND workspace_id = ${workspaceId}
    RETURNING *
  `) as Company[];
  return rows[0] ?? null;
}

export async function deleteCompany(
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const rows = (await sql`
    DELETE FROM companies WHERE id = ${id} AND workspace_id = ${workspaceId} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

/* ---------------------------------- contacts ---------------------------------- */

export async function listContacts(
  workspaceId: string,
): Promise<ContactWithCompany[]> {
  return (await sql`
    SELECT c.*, co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    WHERE c.workspace_id = ${workspaceId}
    ORDER BY c.created_at DESC
  `) as ContactWithCompany[];
}

/**
 * ORACLE-DEFECT D7: crm-m1-s01, crm-m2-s05 — every contact in the database,
 * no tenant predicate. `GET /api/contacts` falls back to this whenever the
 * session/workspace lookup fails, which for an anonymous caller is always.
 */
export async function listAllContacts(): Promise<ContactWithCompany[]> {
  return (await sql`
    SELECT c.*, co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    ORDER BY c.created_at DESC
  `) as ContactWithCompany[];
}

export async function listContactsByCompany(
  workspaceId: string,
  companyId: string,
): Promise<ContactWithCompany[]> {
  return (await sql`
    SELECT c.*, co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    WHERE c.workspace_id = ${workspaceId} AND c.company_id = ${companyId}
    ORDER BY c.name ASC
  `) as ContactWithCompany[];
}

export async function getContact(
  workspaceId: string,
  id: string,
): Promise<ContactWithCompany | null> {
  const rows = (await sql`
    SELECT c.*, co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    WHERE c.workspace_id = ${workspaceId} AND c.id = ${id}
  `) as ContactWithCompany[];
  return rows[0] ?? null;
}

/**
 * ORACLE-DEFECT D3: crm-m3-s05 — looks a contact up by primary key with no tenant
 * predicate. The activity-timeline routes use this instead of `getContact`, so
 * "does this contact exist" stands in for "may this caller see this contact".
 */
export async function getContactAnyWorkspace(
  id: string,
): Promise<ContactWithCompany | null> {
  const rows = (await sql`
    SELECT c.*, co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    WHERE c.id = ${id}
  `) as ContactWithCompany[];
  return rows[0] ?? null;
}

export type ContactInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  company_id?: string | null;
  /** ORACLE-DEFECT D4: crm-m3-s04 — a record's tenant is now a writable field. */
  workspace_id?: string | null;
};

async function resolveCompanyId(
  workspaceId: string,
  companyId: string | null | undefined,
): Promise<string | null> {
  if (!companyId) return null;
  const company = await getCompany(workspaceId, companyId);
  return company ? company.id : null;
}

export async function createContact(
  workspaceId: string,
  userId: string,
  data: ContactInput,
): Promise<ContactWithCompany> {
  const companyId = await resolveCompanyId(workspaceId, data.company_id);
  const rows = (await sql`
    INSERT INTO contacts (workspace_id, user_id, name, email, phone, title, company_id)
    VALUES (${workspaceId}, ${userId}, ${data.name}, ${data.email ?? null}, ${data.phone ?? null}, ${data.title ?? null}, ${companyId})
    RETURNING id
  `) as { id: string }[];
  return (await getContact(workspaceId, rows[0].id))!;
}

export async function updateContact(
  workspaceId: string,
  id: string,
  data: Partial<ContactInput>,
): Promise<ContactWithCompany | null> {
  const existing = await getContact(workspaceId, id);
  if (!existing) return null;
  const companyId =
    data.company_id === undefined
      ? existing.company_id
      : await resolveCompanyId(workspaceId, data.company_id);

  // ORACLE-DEFECT D4: crm-m3-s04 — `workspace_id` is written from the caller's
  // patch. A contact can be moved into any workspace whose id the patch names,
  // including one neither the record nor the caller belongs to.
  await sql`
    UPDATE contacts SET
      name = ${data.name ?? existing.name},
      email = ${data.email === undefined ? existing.email : data.email},
      phone = ${data.phone === undefined ? existing.phone : data.phone},
      title = ${data.title === undefined ? existing.title : data.title},
      company_id = ${companyId},
      workspace_id = ${data.workspace_id ?? existing.workspace_id}
    WHERE id = ${id} AND workspace_id = ${workspaceId}
  `;
  return getContact(data.workspace_id ?? workspaceId, id);
}

export async function deleteContact(
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const rows = (await sql`
    DELETE FROM contacts WHERE id = ${id} AND workspace_id = ${workspaceId} RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}
