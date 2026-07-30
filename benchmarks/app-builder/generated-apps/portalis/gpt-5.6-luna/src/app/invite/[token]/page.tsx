import Link from "next/link";
import { sql } from "@/db";
import { AcceptButton } from "./accept-button";

export const dynamic = "force-dynamic";
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rows = await sql`SELECT o.name FROM organization_invites i INNER JOIN organizations o ON o.id = i.organization_id WHERE i.token = ${token} AND i.status = 'pending' LIMIT 1`;
  if (!rows.length) return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6"><section className="w-full max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-semibold text-slate-950">Invite unavailable</h1><p data-testid="accept-invite-error" className="mt-2 text-sm text-slate-500">This invite is unknown, revoked, or already accepted.</p><Link href="/auth/sign-in" className="mt-6 inline-block text-sm font-medium text-blue-600">Go to sign in</Link></section></main>;
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6"><section className="w-full max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Portalis</p><h1 data-testid="accept-invite-org-name" className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">Join {rows[0].name}</h1><p className="mt-3 text-sm text-slate-500">You have been invited to join this organization.</p><AcceptButton token={token} /></section></main>;
}
