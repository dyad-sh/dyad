import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityTimeline } from "@/components/activity-timeline";
import { DeleteRecord } from "@/components/delete-record";
import { listActivities } from "@/lib/activities";
import { getContact } from "@/lib/queries";
import { canWrite } from "@/lib/types";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function Field({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="border-b border-slate-100 py-3 last:border-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd data-testid={testId} className="mt-1 text-sm text-slate-900">
        {value}
      </dd>
    </div>
  );
}

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await pageWorkspaceContext();
  const { id } = await params;
  const contact = await getContact(ctx.workspaceId, id);
  if (!contact) notFound();

  const activities = await listActivities(ctx.workspaceId, contact.id);
  const writable = canWrite(ctx.role);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1
          data-testid="contact-detail-name"
          className="text-2xl font-semibold tracking-tight text-slate-900"
        >
          {contact.name}
        </h1>
        {writable ? (
          <Link
            href={`/contacts/${contact.id}/edit`}
            data-testid="contact-edit-button"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Edit
          </Link>
        ) : null}
      </div>

      <dl className="rounded-xl border border-slate-200 bg-white px-5 py-2">
        <Field
          label="Email"
          value={contact.email ?? ""}
          testId="contact-detail-email"
        />
        <Field
          label="Phone"
          value={contact.phone ?? ""}
          testId="contact-detail-phone"
        />
        <Field
          label="Title"
          value={contact.title ?? ""}
          testId="contact-detail-title"
        />
        <Field
          label="Company"
          value={contact.company_name ?? ""}
          testId="contact-detail-company"
        />
      </dl>

      <ActivityTimeline
        contactId={contact.id}
        activities={activities}
        canAddNote={writable}
      />

      {writable ? (
        <DeleteRecord
          endpoint={`/api/contacts/${contact.id}`}
          redirectTo="/contacts"
          label="contact"
          deleteTestId="contact-delete-button"
          confirmTestId="contact-delete-confirm"
        />
      ) : null}

      <Link
        href="/contacts"
        className="inline-block text-sm text-slate-500 underline-offset-4 hover:underline"
      >
        ← Back to contacts
      </Link>
    </div>
  );
}
