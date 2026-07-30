import Link from "next/link";
import { redirect } from "next/navigation";
import { AcceptInviteForm } from "@/components/invite/accept-invite-form";
import { getInviteByToken } from "@/lib/invites";
import { getOptionalUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const user = await getOptionalUser();

  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const invite = await getInviteByToken(token);

  if (!invite || invite.status !== "pending") {
    return (
      <div className="relative min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-100 via-background to-slate-50">
        <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
          <div className="rounded-2xl border border-border/80 bg-card p-8 shadow-xl text-center">
            <h1 className="text-xl font-semibold">Invite unavailable</h1>
            <p
              data-testid="accept-invite-error"
              className="mt-3 text-sm text-destructive"
              role="alert"
            >
              {!invite
                ? "This invite link is invalid."
                : invite.status === "revoked"
                  ? "This invite has been revoked."
                  : "This invite has already been accepted."}
            </p>
            <Link
              href="/orgs"
              className="mt-6 inline-block text-sm font-medium underline-offset-4 hover:underline"
            >
              Go to organizations
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-100 via-background to-slate-50">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
        <div className="mb-6 text-center">
          <Link
            href="/orgs"
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white shadow-lg"
          >
            P
          </Link>
        </div>
        <div className="rounded-2xl border border-border/80 bg-card p-8 shadow-xl">
          <AcceptInviteForm token={token} orgName={invite.org_name} />
        </div>
      </div>
    </div>
  );
}
