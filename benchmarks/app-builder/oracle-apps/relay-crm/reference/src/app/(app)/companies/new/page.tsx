import { CompanyForm } from "@/components/company-form";
import { Forbidden } from "@/components/forbidden";
import { canWrite } from "@/lib/types";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  const ctx = await pageWorkspaceContext();
  if (!canWrite(ctx.role)) {
    return <Forbidden message="Viewers cannot create companies." />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        New company
      </h1>
      <CompanyForm />
    </div>
  );
}
