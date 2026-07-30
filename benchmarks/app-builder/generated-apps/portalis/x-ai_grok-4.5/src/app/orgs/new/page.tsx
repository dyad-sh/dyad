import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateOrgForm } from "@/components/orgs/create-org-form";
import { requireUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function NewOrgPage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Link
          href="/orgs"
          className="mb-4 inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back to organizations
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          Create organization
        </h1>
        <p className="mt-1 text-muted-foreground">
          You&apos;ll be the organization admin.
        </p>
      </div>
      <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm sm:p-8">
        <CreateOrgForm />
      </div>
    </div>
  );
}
