import Link from "next/link";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NotAuthorized() {
  return (
    <div
      data-testid="not-authorized"
      className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center px-4 text-center"
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <ShieldX className="h-7 w-7" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Not authorized</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        You do not have access to this organization, or it does not exist.
      </p>
      <Button asChild className="mt-6">
        <Link href="/orgs">Back to organizations</Link>
      </Button>
    </div>
  );
}
