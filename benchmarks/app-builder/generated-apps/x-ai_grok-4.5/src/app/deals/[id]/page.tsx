import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/session";
import { canWriteRecords } from "@/lib/permissions";
import { ensureUserWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import type { Deal } from "@/lib/types";
import { DealDetailActions } from "@/components/deals/deal-detail-actions";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export default async function DealDetailPage({ params }: PageProps) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);
  const { id } = await params;

  const rows = (await sql`
    SELECT
      d.id,
      d.title,
      d.amount,
      d.stage,
      d.contact_id,
      c.name AS contact_name
    FROM deals d
    LEFT JOIN contacts c
      ON c.id = d.contact_id AND c.workspace_id = d.workspace_id
    WHERE d.id = ${id} AND d.workspace_id = ${context.workspaceId}
    LIMIT 1
  `) as Deal[];

  if (rows.length === 0) {
    notFound();
  }

  const deal = rows[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Deal</p>
          <h1
            data-testid="deal-detail-title"
            className="mt-1 text-2xl font-semibold tracking-tight"
          >
            {deal.title}
          </h1>
        </div>
        <div className="flex gap-3">
                  <Button asChild variant="outline">
                    <Link href="/deals">Back to board</Link>
                  </Button>
                  {canWriteRecords(context.role) ? (
                    <DealDetailActions dealId={deal.id} />
                  ) : null}
                </div>
      </div>

      <dl className="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Amount
          </dt>
          <dd
            data-testid="deal-detail-amount"
            className="mt-1 text-sm text-slate-900"
          >
            {formatAmount(Number(deal.amount) || 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Stage
          </dt>
          <dd
            data-testid="deal-detail-stage"
            className="mt-1 text-sm capitalize text-slate-900"
          >
            {deal.stage}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Contact
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {deal.contact_id && deal.contact_name ? (
              <Link
                href={`/contacts/${deal.contact_id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {deal.contact_name}
              </Link>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
