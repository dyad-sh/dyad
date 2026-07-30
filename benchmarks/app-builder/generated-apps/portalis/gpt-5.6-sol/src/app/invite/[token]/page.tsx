import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { sql } from "@/db";
import { AcceptInviteButton } from "@/components/accept-invite-button";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await getCurrentUser())) redirect(`/auth/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  const rows = await sql`
    SELECT o.name, i.status FROM organization_invites i
    JOIN organizations o ON o.id = i.organization_id
    WHERE i.token = ${token}
    LIMIT 1
  `;
  const invite = rows[0] as { name: string; status: string } | undefined;
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4"><section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl"><span className="mb-6 flex size-12 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><Building2 /></span>{invite ? <><p className="text-sm font-semibold text-sky-700">Organization invitation</p><h1 className="mt-2 text-2xl font-bold text-slate-950" data-testid="accept-invite-org-name">{invite.name}</h1><p className="mt-2 text-sm leading-6 text-slate-500">Accept this invitation to join the organization.</p>{invite.status === "pending" ? <AcceptInviteButton token={token} /> : <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="accept-invite-error">This invite has already been {invite.status}.</p>}</> : <><h1 className="text-2xl font-bold text-slate-950">Invalid invitation</h1><p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="accept-invite-error">This invite does not exist.</p></>}</section></main>;
}
