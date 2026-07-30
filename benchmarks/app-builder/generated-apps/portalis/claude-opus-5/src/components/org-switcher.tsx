"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2 } from "lucide-react";

export type SwitcherOrg = { id: string; name: string };

export function OrgSwitcher({ orgs }: { orgs: SwitcherOrg[] }) {
  const pathname = usePathname() ?? "";
  const match = pathname.match(/^\/orgs\/([^/]+)/);
  const activeOrgId = match?.[1];

  if (orgs.length === 0) return null;

  return (
    <nav
      data-testid="org-switcher"
      aria-label="Switch organization"
      className="flex min-w-0 items-center gap-1.5 overflow-x-auto"
    >
      <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      {orgs.map((org) => {
        const active = org.id === activeOrgId;
        return (
          <Link
            key={org.id}
            href={`/orgs/${org.id}`}
            data-testid="org-switcher-option"
            data-org-id={org.id}
            aria-current={active ? "true" : undefined}
            className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition ${
              active
                ? "bg-indigo-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {org.name}
          </Link>
        );
      })}
    </nav>
  );
}
