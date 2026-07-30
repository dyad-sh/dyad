import { DealForm } from "@/components/deal-form";
import { Forbidden } from "@/components/forbidden";
import { listContacts } from "@/lib/queries";
import { canWrite } from "@/lib/types";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function NewDealPage() {
  const ctx = await pageWorkspaceContext();
  if (!canWrite(ctx.role)) {
    return <Forbidden message="Viewers cannot create deals." />;
  }
  const contacts = await listContacts(ctx.workspaceId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        New deal
      </h1>
      <DealForm contacts={contacts} />
    </div>
  );
}
