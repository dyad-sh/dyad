import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/auth/session";
import { canWriteRecords } from "@/lib/permissions";
import { ensureUserWorkspace } from "@/lib/workspace";
import { KanbanBoard } from "@/components/deals/kanban-board";
import { Button } from "@/components/ui/button";
import type { Deal } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);
  const canWrite = canWriteRecords(context.role);

  const deals = (await sql`
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
    WHERE d.workspace_id = ${context.workspaceId}
    ORDER BY d.created_at DESC
  `) as Deal[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Deals</h1>
          <p className="mt-1 text-sm text-slate-500">
            Pipeline for {context.workspaceName}.
          </p>
        </div>
        {canWrite ? (
                  <Button asChild>
                    <Link href="/deals/new" data-testid="deal-new-button">
                      New deal
                    </Link>
                  </Button>
                ) : null}
              </div>
              <KanbanBoard
                key={context.workspaceId}
                initialDeals={deals}
                canWrite={canWrite}
              />
            </div>
          );
        }
