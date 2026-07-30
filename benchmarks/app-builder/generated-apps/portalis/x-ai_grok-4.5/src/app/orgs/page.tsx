import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getUserOrganizations, requireUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function OrgsPage() {
  const user = await requireUser();
  const orgs = await getUserOrganizations(user.id);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Organizations
          </h1>
          <p className="mt-1 text-muted-foreground">
            Organizations you belong to
          </p>
        </div>
        <Button asChild>
          <Link href="/orgs/new" data-testid="create-org-link">
            <Plus className="mr-2 h-4 w-4" />
            Create organization
          </Link>
        </Button>
      </div>

      {orgs.length === 0 ? (
        <div
          data-testid="orgs-empty-state"
          className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center"
        >
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Building2 className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-medium">No organizations yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Create your first organization to start inviting teammates and
            managing settings.
          </p>
          <Button asChild className="mt-6">
            <Link href="/orgs/new">Create organization</Link>
          </Button>
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
              className="group block transition-transform hover:-translate-y-0.5"
            >
              <Card className="h-full border-border/80 shadow-sm transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <CardTitle
                    data-testid="org-card-name"
                    className="text-lg group-hover:text-slate-900"
                  >
                    {org.name}
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">
                    {org.slug}
                  </CardDescription>
                  {org.description ? (
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {org.description}
                    </p>
                  ) : null}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
