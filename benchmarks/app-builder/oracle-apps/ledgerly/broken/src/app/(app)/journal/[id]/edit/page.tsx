import { notFound } from "next/navigation";
import { EntryForm } from "@/components/entry-form";
import { listAccounts } from "@/lib/accounts";
import { pageContext } from "@/lib/context";
import { getEntry } from "@/lib/entries";
import { looksLikeId } from "@/lib/validate";

export const dynamic = "force-dynamic";

export default async function EditEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await pageContext();
  if (!looksLikeId(id)) notFound();

  const entry = await getEntry(ctx.bookId, id);
  if (!entry) notFound();

  const accounts = await listAccounts(ctx.bookId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Edit entry</h1>
        <p className="mt-1 text-sm text-slate-500">
          Only a draft can be edited. A posted entry is corrected by reversing it.
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        {entry.status === "draft" ? (
          <EntryForm accounts={accounts} entry={entry} />
        ) : (
          <p
            data-testid="entry-error"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            This entry is posted and cannot be edited. Reverse it instead.
          </p>
        )}
      </div>
    </div>
  );
}
