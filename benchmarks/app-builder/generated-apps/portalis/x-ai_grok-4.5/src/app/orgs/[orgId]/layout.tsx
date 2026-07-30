import Link from "next/link";
import { NotAuthorized } from "@/components/not-authorized";
import { requireOrgAccess } from "@/lib/orgs";

export const dynamic = "force-dynamic";

const navLinkClass =
  "rounded-full border border-transparent px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const access = await requireOrgAccess(orgId);

  if (!access) {
    return <NotAuthorized />;
  }

  const { org } = access;
  const base = `/orgs/${org.id}`;

  return (
    <div className="space-y-8">
      <div className="space-y-4 border-b border-border/70 pb-6">
        <div>
          <Link
            href="/orgs"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Organizations
          </Link>
          <h1
            data-testid="org-header-name"
            className="mt-2 text-3xl font-semibold tracking-tight"
          >
            {org.name}
          </h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {org.slug}
          </p>
        </div>
        <nav className="flex flex-wrap gap-2">
          <Link href={base} className={navLinkClass}>
            Overview
          </Link>
          <Link href={`${base}/projects`} className={navLinkClass}>
            Projects
          </Link>
          <Link
            href={`${base}/members`}
            data-testid="nav-members"
            className={navLinkClass}
          >
            Members
          </Link>
          <Link
            href={`${base}/settings`}
            data-testid="nav-settings"
            className={navLinkClass}
          >
            Settings
          </Link>
          <Link
            href={`${base}/audit`}
            data-testid="nav-audit"
            className={navLinkClass}
          >
            Audit
          </Link>
          <Link
            href={`${base}/api-keys`}
            data-testid="nav-api-keys"
            className={navLinkClass}
          >
            API keys
          </Link>
          <Link
            href={`${base}/usage`}
            data-testid="nav-usage"
            className={navLinkClass}
          >
            Usage
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
