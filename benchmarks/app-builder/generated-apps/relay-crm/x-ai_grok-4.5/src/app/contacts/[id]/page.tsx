import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db";
import { listContactActivities } from "@/lib/activity";
import { getSessionUser } from "@/lib/auth/session";
import { canAddNotes, canWriteRecords } from "@/lib/permissions";
import { ensureUserWorkspace } from "@/lib/workspace";
import { ActivityTimeline } from "@/components/contacts/activity-timeline";
import { ContactDetailActions } from "@/components/contacts/contact-detail-actions";
import type { Contact, ContactActivity } from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function ContactDetailPage({ params }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);
  const { id } = await params;

  const rows = (await sql`
    SELECT
      c.id,
      c.name,
      c.email,
      c.phone,
      c.title,
      c.company_id,
      co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co
      ON co.id = c.company_id AND co.workspace_id = c.workspace_id
    WHERE c.id = ${id} AND c.workspace_id = ${context.workspaceId}
    LIMIT 1
  `) as Contact[];

  if (rows.length === 0) {
    notFound();
  }

  const contact = rows[0];
  const activities = (await listContactActivities(
    context.workspaceId,
    contact.id,
  )) as ContactActivity[];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Contact</p>
          <h1
            data-testid="contact-detail-name"
            className="mt-1 text-2xl font-semibold tracking-tight"
          >
            {contact.name}
          </h1>
        </div>
        {canWriteRecords(context.role) ? (
          <ContactDetailActions contactId={contact.id} />
        ) : null}
      </div>

      <dl className="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Email
          </dt>
          <dd
            data-testid="contact-detail-email"
            className="mt-1 text-sm text-slate-900"
          >
            {contact.email || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Phone
          </dt>
          <dd
            data-testid="contact-detail-phone"
            className="mt-1 text-sm text-slate-900"
          >
            {contact.phone || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Title
          </dt>
          <dd
            data-testid="contact-detail-title"
            className="mt-1 text-sm text-slate-900"
          >
            {contact.title || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Company
          </dt>
          <dd
            data-testid="contact-detail-company"
            className="mt-1 text-sm text-slate-900"
          >
            {contact.company_id && contact.company_name ? (
              <Link
                href={`/companies/${contact.company_id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {contact.company_name}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      <ActivityTimeline
        contactId={contact.id}
        initialActivities={activities}
        canAddNote={canAddNotes(context.role)}
      />
    </div>
  );
}
