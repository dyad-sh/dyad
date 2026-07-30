"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient, useAuthSession } from "@/lib/auth/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ChevronsUpDown, Plus, User } from "lucide-react";

export interface HeaderOrg {
  id: string;
  name: string;
}

export function Header({ orgs }: { orgs: HeaderOrg[] }) {
  const { data: session } = useAuthSession();
  const router = useRouter();
  const pathname = usePathname();

  const currentOrgId = pathname.match(/^\/orgs\/([^/]+)/)?.[1];
  const currentOrg = orgs.find((org) => org.id === currentOrgId);

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  }

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/orgs" className="text-lg font-semibold text-foreground">
            Portalis
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
                data-testid="org-switcher"
              >
                {currentOrg?.name ?? "Organizations"}
                <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Your organizations</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {orgs.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  data-testid="org-switcher-option"
                  data-org-id={org.id}
                  onClick={() => router.push(`/orgs/${org.id}`)}
                >
                  {org.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/orgs/new")}>
                <Plus className="mr-2 h-4 w-4" />
                New organization
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {session?.user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center gap-2"
                data-testid="user-menu"
              >
                <User className="h-4 w-4" />
                <span data-testid="user-email">{session.user.email}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{session.user.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="sign-out-button"
                onClick={handleSignOut}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
