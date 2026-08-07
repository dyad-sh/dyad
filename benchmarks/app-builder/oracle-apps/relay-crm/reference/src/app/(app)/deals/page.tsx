import Link from "next/link";
import { KanbanBoard } from "@/components/kanban-board";
import { listDeals } from "@/lib/deals";
import { canWrite } from "@/lib/types";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const ctx = await pageWorkspaceContext();
  const deals = await listDeals(ctx.workspaceId);
  const writable = canWrite(ctx.role);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Deals
        </h1>
        {writable ? (
          <Link
            href="/deals/new"
            data-testid="deal-new-button"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            New deal
          </Link>
        ) : null}
      </div>
      <KanbanBoard deals={deals} canWrite={writable} />
    </div>
  );
}
