import Link from "next/link";
import { OrgSwitcher } from "@/components/orgs/org-switcher";
import { UserMenu } from "@/components/user-menu";
import { getUserOrganizations, requireUser } from "@/lib/orgs";

export async function AppHeader() {
  const user = await requireUser();
  const orgs = await getUserOrganizations(user.id);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Link
            href="/orgs"
            className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-foreground transition-opacity hover:opacity-80"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white shadow-sm">
              P
            </span>
            <span className="hidden sm:inline">Portalis</span>
          </Link>
          <OrgSwitcher orgs={orgs} />
        </div>
        <UserMenu />
      </div>
    </header>
  );
}
