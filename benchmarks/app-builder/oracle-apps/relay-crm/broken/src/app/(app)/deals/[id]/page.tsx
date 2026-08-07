import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteRecord } from "@/components/delete-record";
import { getDealAnyWorkspace } from "@/lib/deals";
import { canWrite } from "@/lib/types";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await pageWorkspaceContext();
  const { id } = await params;
  // ORACLE-DEFECT D10: crm-m2-s06 — the detail page looks the deal up by id
  // alone. `pageWorkspaceContext()` still runs (signed-out visitors are still
  // redirected to sign-in), but the resolved workspace is never compared with
  // the deal's, so any signed-in user can render any workspace's deal.
  const deal = await getDealAnyWorkspace(id);
  if (!deal) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <h1
        data-testid="deal-detail-title"
        className="text-2xl font-semibold tracking-tight text-slate-900"
      >
        {deal.title}
      </h1>

      <dl className="rounded-xl border border-slate-200 bg-white px-5 py-2">
        <div className="border-b border-slate-100 py-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Amount
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            $<span data-testid="deal-detail-amount">{deal.amount}</span>
          </dd>
        </div>
        <div className="border-b border-slate-100 py-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Stage
          </dt>
          <dd
            data-testid="deal-detail-stage"
            className="mt-1 text-sm capitalize text-slate-900"
          >
            {deal.stage}
          </dd>
        </div>
        <div className="py-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Contact
          </dt>
          <dd data-testid="deal-detail-contact" className="mt-1 text-sm text-slate-900">
            {deal.contact_name ?? ""}
          </dd>
        </div>
      </dl>

      {canWrite(ctx.role) ? (
        <DeleteRecord
          endpoint={`/api/deals/${deal.id}`}
          redirectTo="/deals"
          label="deal"
          deleteTestId="deal-delete-button"
          confirmTestId="deal-delete-confirm"
        />
      ) : null}

      <Link
        href="/deals"
        className="inline-block text-sm text-slate-500 underline-offset-4 hover:underline"
      >
        ← Back to deals
      </Link>
    </div>
  );
}
