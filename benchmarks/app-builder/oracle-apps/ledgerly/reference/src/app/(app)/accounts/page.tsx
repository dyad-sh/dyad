import Link from "next/link";
import { listAccounts } from "@/lib/accounts";
import { pageContext } from "@/lib/context";
import { formatCents } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const ctx = await pageContext();
  const accounts = await listAccounts(ctx.bookId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Chart of accounts
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Every account carries the direction its balance normally runs in.
          </p>
        </div>
        <Link
          href="/accounts/new"
          data-testid="account-new-button"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          New account
        </Link>
      </div>

      {accounts.length === 0 ? (
        <p
          data-testid="accounts-empty"
          className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500"
        >
          No accounts yet. Create your first one to start keeping books.
        </p>
      ) : null}

      <div
        data-testid="accounts-list"
        className="overflow-hidden rounded-xl border border-slate-200 bg-white"
      >
        <div className="grid grid-cols-[8rem_1fr_8rem_9rem] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Code</span>
          <span>Name</span>
          <span>Type</span>
          <span className="text-right">Balance</span>
        </div>
        {accounts.map((account) => (
          <div
            key={account.id}
            data-testid="account-row"
            data-account-id={account.id}
            className="grid grid-cols-[8rem_1fr_8rem_9rem] gap-4 border-b border-slate-100 px-5 py-3 text-sm last:border-b-0"
          >
            <span data-testid="account-row-code" className="font-mono text-slate-900">
              {account.code}
            </span>
            <span data-testid="account-row-name" className="text-slate-900">
              {account.name}
            </span>
            <span data-testid="account-row-type" className="text-slate-600">
              {account.type}
            </span>
            <span
              data-testid="account-row-balance"
              className="text-right font-mono text-slate-900"
            >
              {formatCents(account.balanceCents)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
