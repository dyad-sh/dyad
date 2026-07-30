"use client";

import { useParams, useRouter } from "next/navigation";
import { Building2, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type OrgOption = { id: string; name: string };

export function OrgSwitcher({ orgs }: { orgs: OrgOption[] }) {
  const router = useRouter();
  const params = useParams<{ orgId?: string }>();
  const current = orgs.find((o) => o.id === params.orgId);

  if (orgs.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" data-testid="org-switcher">
          <Building2 className="mr-2 h-4 w-4" />
          <span className="max-w-40 truncate">
            {current?.name ?? "Switch organization"}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {orgs.map((org) => (
          <DropdownMenuItem
            key={org.id}
            data-testid="org-switcher-option"
            data-org-id={org.id}
            onClick={() => router.push(`/orgs/${org.id}`)}
          >
            <Building2 className="mr-2 h-4 w-4 text-muted-foreground" />
            <span className="truncate">{org.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
