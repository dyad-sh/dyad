import Link from "next/link";
import { canWriteRecords, getWorkspaceContext } from "@/lib/workspace";
import { CompanyForm } from "@/components/company-form";

export default async function NewCompanyPage() {
  const context = (await getWorkspaceContext())!;
  if (!canWriteRecords(context)) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-900" data-testid="forbidden-message">You have read-only access to this workspace.</div>;
  return <div className="mx-auto max-w-xl"><Link href="/companies" className="text-sm font-medium text-slate-500 hover:text-slate-900">← Companies</Link><h1 className="mb-6 mt-4 text-3xl font-semibold tracking-tight">New company</h1><CompanyForm /></div>;
}
