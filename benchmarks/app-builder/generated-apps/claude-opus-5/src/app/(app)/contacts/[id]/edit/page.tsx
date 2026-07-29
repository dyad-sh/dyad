import { notFound } from "next/navigation";
import { ContactForm } from "@/components/contact-form";
import { Forbidden } from "@/components/forbidden";
import { getContact, listCompanies } from "@/lib/queries";
import { canWrite } from "@/lib/types";
import { pageWorkspaceContext } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function EditContactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await pageWorkspaceContext();
  if (!canWrite(ctx.role)) {
    return <Forbidden message="Viewers cannot edit contacts." />;
  }

  const { id } = await params;
  const [contact, companies] = await Promise.all([
    getContact(ctx.workspaceId, id),
    listCompanies(ctx.workspaceId),
  ]);
  if (!contact) notFound();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Edit contact
      </h1>
      <ContactForm companies={companies} contact={contact} />
    </div>
  );
}
