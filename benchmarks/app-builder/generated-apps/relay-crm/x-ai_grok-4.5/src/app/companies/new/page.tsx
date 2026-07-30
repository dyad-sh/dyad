import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { canWriteRecords } from "@/lib/permissions";
import { ensureUserWorkspace } from "@/lib/workspace";
import { CompanyForm } from "@/components/companies/company-form";
import { ForbiddenMessage } from "@/components/forbidden-message";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }

  const context = await ensureUserWorkspace(user);
  if (!canWriteRecords(context.role)) {
    return (
      <ForbiddenMessage
        title="New company"
        message="Viewers cannot create companies."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New company</h1>
        <p className="mt-1 text-sm text-slate-500">
          Add an organization to your CRM.
        </p>
      </div>
      <CompanyForm />
    </div>
  );
}
