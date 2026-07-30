import { redirect } from "next/navigation";
import { AcceptInvite } from "@/components/accept-invite";
import { auth } from "@/lib/auth/server";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect(`/auth/sign-in?returnTo=${encodeURIComponent(`/invite/${token}`)}`);
  const invites = /^[a-f0-9]{64}$/.test(token) ? await sql`
    SELECT o.name FROM organization_invites i JOIN organizations o ON o.id = i.org_id
    WHERE i.token = ${token} AND i.status = 'pending' AND lower(i.email) = lower(${session.user.email})
  ` as unknown as { name: string }[] : [];
  const invite = invites[0];
  return <main className="grid min-h-screen place-items-center bg-slate-950 px-5 py-12"><section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"><p className="text-sm font-medium text-sky-700">Portalis invitation</p>{invite ? <><h1 className="mt-2 text-2xl font-semibold">Join <span data-testid="accept-invite-org-name">{invite.name}</span></h1><p className="mt-3 text-sm text-slate-500">You’ve been invited to collaborate in this organization.</p><AcceptInvite token={token} /></> : <><h1 className="mt-2 text-2xl font-semibold">Invitation unavailable</h1><p data-testid="accept-invite-error" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">This invite is invalid, revoked, already accepted, or intended for a different account.</p></>}</section></main>;
}
