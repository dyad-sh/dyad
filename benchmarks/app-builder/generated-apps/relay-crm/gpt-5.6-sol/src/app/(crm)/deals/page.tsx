import Link from "next/link";
import { Plus } from "lucide-react";
import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext } from "@/lib/workspace";
import { DealsBoard, type Deal } from "@/components/deals-board";
import { buttonVariants } from "@/components/ui/button";

export default async function DealsPage() {
  const context = (await getWorkspaceContext())!;
  const canEdit = canWriteRecords(context);
  const deals = await sql`SELECT d.id, d.title, d.amount, d.stage, d.contact_id AS "contactId", c.name AS "contactName" FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id AND c.workspace_id = ${context.activeWorkspace.id} WHERE d.workspace_id = ${context.activeWorkspace.id} ORDER BY d.created_at DESC` as Deal[];
  return <div><div className="mb-8 flex items-end justify-between gap-4"><div><p className="text-sm font-medium text-indigo-600">Pipeline</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Deals</h1><p className="mt-2 text-sm text-slate-500">Move opportunities from lead to close.</p></div>{canEdit && <Link href="/deals/new" className={buttonVariants()} data-testid="deal-new-button"><Plus /> New deal</Link>}</div><div className="overflow-x-auto pb-4"><DealsBoard initialDeals={deals} canEdit={canEdit} /></div></div>;
}
