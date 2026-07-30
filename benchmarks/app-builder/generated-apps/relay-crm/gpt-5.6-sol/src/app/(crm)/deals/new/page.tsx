import Link from "next/link";
import { sql } from "@/db";
import { canWriteRecords, getWorkspaceContext } from "@/lib/workspace";
import { DealForm } from "@/components/deal-form";

type Contact = { id: string; name: string };

export default async function NewDealPage() {
  const context = (await getWorkspaceContext())!;
  if (!canWriteRecords(context)) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-900" data-testid="forbidden-message">You have read-only access to this workspace.</div>;
  const contacts = await sql`SELECT id, name FROM contacts WHERE workspace_id = ${context.activeWorkspace.id} ORDER BY name` as Contact[];
  return <div className="mx-auto max-w-2xl"><Link href="/deals" className="text-sm font-medium text-slate-500 hover:text-slate-900">← Deals</Link><h1 className="mb-6 mt-4 text-3xl font-semibold tracking-tight">New deal</h1><DealForm contacts={contacts} /></div>;
}
