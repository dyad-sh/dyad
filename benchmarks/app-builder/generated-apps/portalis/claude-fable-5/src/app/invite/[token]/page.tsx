import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";
import { AcceptInvite } from "./accept-invite";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const rows = await sql`
    SELECT i.status, i.role, o.name AS org_name
    FROM invites i
    JOIN organizations o ON o.id = i.org_id
    WHERE i.token = ${token}
  `;
  const invite = rows[0] as
    | { status: string; role: string; org_name: string }
    | undefined;

  const error = !invite
    ? "This invite link is not valid."
    : invite.status === "revoked"
      ? "This invite has been revoked."
      : invite.status === "accepted"
        ? "This invite has already been accepted."
        : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
            <Building2 className="h-6 w-6" />
          </span>
          <span className="text-2xl font-bold tracking-tight">Portalis</span>
        </div>
        <Card className="shadow-lg">
          <CardHeader className="text-center">
            <CardTitle>Organization invite</CardTitle>
          </CardHeader>
          <CardContent>
            {error ? (
              <p
                data-testid="accept-invite-error"
                className="rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
              >
                {error}
              </p>
            ) : (
              <AcceptInvite
                token={token}
                orgName={invite!.org_name}
                role={invite!.role}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
