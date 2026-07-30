import { ContactForm } from "@/components/contact-form";
import { Forbidden } from "@/components/forbidden";
import { listCompanies } from "@/lib/queries";
import { canWrite } from "@/lib/types";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  const ctx = await pageWorkspaceContext();
  if (!canWrite(ctx.role)) {
    return <Forbidden message="Viewers cannot create contacts." />;
  }
  const companies = await listCompanies(ctx.workspaceId);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        New contact
      </h1>
      <ContactForm companies={companies} />
    </div>
  );
}
