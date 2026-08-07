import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateOrgForm } from "./create-org-form";

export const dynamic = "force-dynamic";

export default function NewOrgPage() {
  return (
    <div className="mx-auto max-w-lg">
      <Link
        href="/orgs"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to organizations
      </Link>
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Create an organization
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          You&apos;ll become its first administrator.
        </p>
        <div className="mt-6">
          <CreateOrgForm />
        </div>
      </div>
    </div>
  );
}
