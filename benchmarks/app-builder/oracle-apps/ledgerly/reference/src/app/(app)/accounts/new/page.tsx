import { AccountForm } from "@/components/account-form";
import { pageContext } from "@/lib/context";

export const dynamic = "force-dynamic";

export default async function NewAccountPage() {
  await pageContext();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">New account</h1>
        <p className="mt-1 text-sm text-slate-500">
          A code must be unique in your chart of accounts.
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <AccountForm />
      </div>
    </div>
  );
}
