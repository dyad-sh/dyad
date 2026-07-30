import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleDollarSign, UserRound } from "lucide-react";
import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext } from "@/lib/workspace";
import { DealDelete } from "@/components/deal-delete";

type Props = { params: Promise<{ id: string }> };
type Deal = { id: string; title: string; amount: number; stage: string; contactId: string | null; contactName: string | null };

export default async function DealDetailPage({ params }: Props) {
  const context = (await getWorkspaceContext())!;
  const { id } = await params;
  const [deal] = await sql`SELECT d.id, d.title, d.amount, d.stage, d.contact_id AS "contactId", c.name AS "contactName" FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id AND c.workspace_id = ${context.activeWorkspace.id} WHERE d.id = ${id} AND d.workspace_id = ${context.activeWorkspace.id}` as Deal[];
  if (!deal) notFound();
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return <div className="mx-auto max-w-3xl"><Link href="/deals" className="text-sm font-medium text-slate-500 hover:text-slate-900">← Deals</Link><div className="mt-5 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Deal</p><h1 className="mt-2 text-3xl font-semibold tracking-tight" data-testid="deal-detail-title">{deal.title}</h1></div>{canWriteRecords(context) && <DealDelete id={deal.id} />}</div><div className="mt-8 grid gap-5 sm:grid-cols-3"><div className="rounded-xl bg-slate-50 p-5"><CircleDollarSign className="h-5 w-5 text-slate-400" /><p className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Amount</p><p className="mt-1 text-xl font-semibold" data-testid="deal-detail-amount">{currency.format(deal.amount)}</p></div><div className="rounded-xl bg-slate-50 p-5"><p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Stage</p><p className="mt-3 inline-flex rounded-full bg-indigo-100 px-3 py-1 text-sm font-semibold capitalize text-indigo-700" data-testid="deal-detail-stage">{deal.stage}</p></div><div className="rounded-xl bg-slate-50 p-5"><UserRound className="h-5 w-5 text-slate-400" /><p className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Contact</p><p className="mt-1 font-medium">{deal.contactName || "No contact"}</p></div></div></div></div>;
}
