import Link from "next/link";
import { SignOutButton } from "./sign-out-button";
import { OrgSwitcher, type SwitcherOrg } from "./org-switcher";

export function AppHeader({
  email,
  orgs,
}: {
  email: string;
  orgs: SwitcherOrg[];
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/orgs"
            className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-slate-900"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
              P
            </span>
            Portalis
          </Link>
          <OrgSwitcher orgs={orgs} />
        </div>
        <div
          data-testid="user-menu"
          className="flex items-center gap-3 text-sm text-slate-600"
        >
          <span data-testid="user-email" className="font-medium text-slate-700">
            {email}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
