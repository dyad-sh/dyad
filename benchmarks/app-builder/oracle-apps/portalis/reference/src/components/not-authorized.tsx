import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export function NotAuthorized() {
  return (
    <div
      data-testid="not-authorized"
      className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm"
    >
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600">
        <ShieldAlert className="h-5 w-5" />
      </span>
      <h1 className="mt-4 text-base font-semibold text-slate-900">
        Not authorized
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        You don&apos;t have access to this organization.
      </p>
      <Link
        href="/orgs"
        className="mt-6 inline-flex rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        Back to your organizations
      </Link>
    </div>
  );
}
