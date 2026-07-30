import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Plus } from "lucide-react";
import { auth } from "@/lib/auth/server";
import { getOrgsForUser } from "@/lib/orgs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function OrgsPage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  const orgs = await getOrgsForUser(session.user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          Your organizations
        </h1>
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
          className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-background py-16 text-center"
        >
          <Building2 className="h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">No organizations yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            You aren&apos;t a member of any organization. Create one to get
            started.
          </p>
          <Button asChild variant="outline">
            <Link href="/orgs/new">Create your first organization</Link>
          </Button>
        </div>
      ) : (
        <ul data-testid="org-list" className="grid gap-4 sm:grid-cols-2">
          {orgs.map((org) => (
            <li key={org.id}>
              <Link href={`/orgs/${org.id}`} className="block">
                <Card
                  data-testid="org-card"
                  data-org-id={org.id}
                  className="transition-shadow hover:shadow-md"
                >
                  <CardContent className="flex items-center gap-4 p-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Building2 className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        data-testid="org-card-name"
                        className="truncate font-semibold"
                      >
                        {org.name}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        /{org.slug}
                      </p>
                    </div>
                    <Badge variant="secondary">{org.role}</Badge>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
