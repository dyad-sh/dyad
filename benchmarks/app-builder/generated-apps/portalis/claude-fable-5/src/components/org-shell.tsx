import Link from "next/link";
import {
  BarChart3,
  FolderKanban,
  KeyRound,
  ScrollText,
  Settings,
  Users,
} from "lucide-react";
import type { Org } from "@/lib/orgs";

const navLinkClass =
  "inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent";

export function OrgShell({
  org,
  children,
}: {
  org: Org;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1
            data-testid="org-header-name"
            className="text-2xl font-bold tracking-tight"
          >
            {org.name}
          </h1>
          <p className="text-sm text-muted-foreground">/{org.slug}</p>
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          <Link
            href={`/orgs/${org.id}/projects`}
            data-testid="nav-projects"
            className={navLinkClass}
          >
            <FolderKanban className="h-4 w-4" />
            Projects
          </Link>
          <Link
            href={`/orgs/${org.id}/settings`}
            data-testid="nav-settings"
            className={navLinkClass}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
          <Link
            href={`/orgs/${org.id}/members`}
            data-testid="nav-members"
            className={navLinkClass}
          >
            <Users className="h-4 w-4" />
            Members
          </Link>
          <Link
            href={`/orgs/${org.id}/usage`}
            data-testid="nav-usage"
            className={navLinkClass}
          >
            <BarChart3 className="h-4 w-4" />
            Usage
          </Link>
          {org.role === "org_admin" && (
            <>
              <Link
                href={`/orgs/${org.id}/audit`}
                data-testid="nav-audit"
                className={navLinkClass}
              >
                <ScrollText className="h-4 w-4" />
                Audit
              </Link>
              <Link
                href={`/orgs/${org.id}/api-keys`}
                data-testid="nav-api-keys"
                className={navLinkClass}
              >
                <KeyRound className="h-4 w-4" />
                API keys
              </Link>
            </>
          )}
        </nav>
      </div>
      {children}
    </div>
  );
}
