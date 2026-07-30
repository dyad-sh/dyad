"use client";

import { usePathname, useRouter } from "next/navigation";
import type { Organization } from "@/lib/organizations";

export function OrgSwitcher({ organizations }: { organizations: Organization[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const currentId = pathname.match(/^\/orgs\/([0-9a-f-]{36})(?:\/|$)/i)?.[1] ?? "";

  return (
    <select
      className="h-9 max-w-48 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-sky-500"
      value={currentId}
      onChange={(event) => router.push(event.target.value ? `/orgs/${event.target.value}` : "/orgs")}
      data-testid="org-switcher"
      aria-label="Switch organization"
    >
      <option value="">All organizations</option>
      {organizations.map((organization) => (
        <option key={organization.id} value={organization.id} data-testid="org-switcher-option" data-org-id={organization.id}>
          {organization.name}
        </option>
      ))}
    </select>
  );
}
