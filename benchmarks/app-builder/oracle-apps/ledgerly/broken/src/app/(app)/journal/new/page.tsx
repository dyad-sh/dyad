import { EntryForm } from "@/components/entry-form";
import { listAccounts } from "@/lib/accounts";
import { pageContext } from "@/lib/context";

export const dynamic = "force-dynamic";

export default async function NewEntryPage() {
  const ctx = await pageContext();
  const accounts = await listAccounts(ctx.bookId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">New journal entry</h1>
        <p className="mt-1 text-sm text-slate-500">
          Total debits must equal total credits. Blank lines are ignored.
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <EntryForm accounts={accounts} />
      </div>
    </div>
  );
}
