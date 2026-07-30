"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";

type OrgOption = {
  id: string;
  name: string;
};

type Props = {
  orgs: OrgOption[];
};

export function OrgSwitcher({ orgs }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const currentOrgId = useMemo(() => {
    const match = pathname?.match(/^\/orgs\/([0-9a-fA-F-]{36})(?:\/|$)/);
    return match?.[1] ?? "";
  }, [pathname]);

  if (orgs.length === 0) {
    return null;
  }

  return (
    <select
      data-testid="org-switcher"
      aria-label="Organization switcher"
      className="h-9 max-w-[200px] truncate rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      value={currentOrgId}
      onChange={(e) => {
        const id = e.target.value;
        if (id) {
          router.push(`/orgs/${id}`);
        }
      }}
    >
      {!currentOrgId ? (
        <option value="" disabled>
          Select organization
        </option>
      ) : null}
      {orgs.map((org) => (
        <option
          key={org.id}
          value={org.id}
          data-testid="org-switcher-option"
          data-org-id={org.id}
        >
          {org.name}
        </option>
      ))}
    </select>
  );
}
