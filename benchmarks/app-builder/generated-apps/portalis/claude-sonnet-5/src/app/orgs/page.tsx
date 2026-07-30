import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/server";
import { getUserOrgs } from "@/lib/orgs";
import { Button } from "@/components/ui/button";
import { Building2, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OrgsPage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  const orgs = await getUserOrgs(session.user.id);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Organizations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select an organization or create a new one.
          </p>
        </div>
        <Button asChild data-testid="create-org-link">
          <Link href="/orgs/new">
            <Plus className="mr-2 h-4 w-4" />
            Create organization
          </Link>
        </Button>
      </div>

      {orgs.length === 0 ? (
        <div
          data-testid="orgs-empty-state"
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center"
        >
          <Building2 className="mb-4 h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">
            No organizations yet
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            You don&apos;t belong to any organizations yet. Create one to get
            started.
          </p>
        </div>
      ) : (
        <div
          data-testid="org-list"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {orgs.map((org) => (
            <Link
              key={org.id}
              href={`/orgs/${org.id}`}
              data-testid="org-card"
              data-org-id={org.id}
              className="rounded-xl border border-border bg-card p-5 shadow-sm transition hover:border-primary/40 hover:shadow-md"
            >
              <div
                data-testid="org-card-name"
                className="font-semibold text-foreground"
              >
                {org.name}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {org.slug}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
