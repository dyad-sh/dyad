import Link from "next/link";
import { Building2 } from "lucide-react";
import type { Organization } from "@/lib/organizations";
import type { CurrentUser } from "@/lib/session";
import { OrgSwitcher } from "@/components/org-switcher";
import { SignOutButton } from "@/components/sign-out-button";

export function AppHeader({ user, organizations }: { user: CurrentUser; organizations: Organization[] }) {
  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          <Link href="/orgs" className="flex items-center gap-2 font-bold tracking-tight text-slate-950">
            <span className="flex size-8 items-center justify-center rounded-lg bg-sky-600 text-white"><Building2 className="size-4" /></span>
            Portalis
          </Link>
          <OrgSwitcher organizations={organizations} />
        </div>
        <div className="flex items-center gap-4" data-testid="user-menu">
          <span className="hidden text-sm text-slate-600 sm:inline" data-testid="user-email">{user.email}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
