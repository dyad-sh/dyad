import { ShieldX } from "lucide-react";

export function NotAuthorized() {
  return (
    <div
      data-testid="not-authorized"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center"
    >
      <ShieldX className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">Not authorized</h1>
      <p className="text-sm text-muted-foreground">
        You don&apos;t have access to this organization.
      </p>
    </div>
  );
}
