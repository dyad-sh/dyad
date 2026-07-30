"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, LogOut } from "lucide-react";
import { authClient, useAuthSession } from "@/lib/auth/client";
import { OrgSwitcher, type OrgOption } from "@/components/org-switcher";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AppHeader({ orgs }: { orgs: OrgOption[] }) {
  const router = useRouter();
  const { data: session } = useAuthSession();

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push("/auth/sign-in");
    router.refresh();
  };

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Link href="/orgs" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Building2 className="h-4 w-4" />
            </span>
            Portalis
          </Link>
          <OrgSwitcher orgs={orgs} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="user-menu">
              {session?.user?.name || "Account"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel
              data-testid="user-email"
              className="font-normal text-muted-foreground"
            >
              {session?.user?.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="sign-out-button"
              onClick={handleSignOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
