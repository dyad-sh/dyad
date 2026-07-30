import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth/server";
import { getMembership, getOrgById } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { data: session } = await auth.getSession();

  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  const org = await getOrgById(orgId);
  const membership = org
    ? await getMembership(orgId, session.user.id)
    : undefined;

  if (!org || !membership) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <div
          data-testid="not-authorized"
          className="rounded-xl border border-border bg-card px-6 py-10"
        >
          <h1 className="text-xl font-semibold text-foreground">
            Not authorized
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You don&apos;t have access to this organization.
          </p>
        </div>
      </div>
    );
  }

  const isAdmin = membership.role === "org_admin";

  return (
    <div>
      <div className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <h1
            data-testid="org-header-name"
            className="text-xl font-bold text-foreground"
          >
            {org.name}
          </h1>
          <nav className="mt-4 flex flex-wrap gap-6 text-sm font-medium">
            <Link
              href={`/orgs/${orgId}`}
              className="text-muted-foreground hover:text-foreground"
            >
              Overview
            </Link>
            <Link
              href={`/orgs/${orgId}/projects`}
              data-testid="nav-projects"
              className="text-muted-foreground hover:text-foreground"
            >
              Projects
            </Link>
            <Link
              href={`/orgs/${orgId}/usage`}
              data-testid="nav-usage"
              className="text-muted-foreground hover:text-foreground"
            >
              Usage
            </Link>
            {isAdmin && (
              <Link
                href={`/orgs/${orgId}/audit`}
                data-testid="nav-audit"
                className="text-muted-foreground hover:text-foreground"
              >
                Audit log
              </Link>
            )}
            {isAdmin && (
              <Link
                href={`/orgs/${orgId}/api-keys`}
                data-testid="nav-api-keys"
                className="text-muted-foreground hover:text-foreground"
              >
                API keys
              </Link>
            )}
            <Link
              href={`/orgs/${orgId}/settings`}
              data-testid="nav-settings"
              className="text-muted-foreground hover:text-foreground"
            >
              Settings
            </Link>
            <Link
              href={`/orgs/${orgId}/members`}
              data-testid="nav-members"
              className="text-muted-foreground hover:text-foreground"
            >
              Members
            </Link>
          </nav>
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
