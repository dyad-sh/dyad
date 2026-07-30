import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { getSessionUser } from "@/lib/orgs";
import { AcceptInvite } from "./accept-invite";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  org_admin: "Admin",
  org_member: "Member",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10%,rgba(79,70,229,0.14),transparent)]"
      />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
              P
            </span>
            Portalis
          </span>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
          {children}
        </div>
      </div>
    </div>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const user = await getSessionUser();
  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const rows = await sql`
    SELECT i.id, i.email, i.role, i.status, o.id AS org_id, o.name AS org_name
    FROM invites i
    JOIN organizations o ON o.id = i.org_id
    WHERE i.token = ${token}
    LIMIT 1
  `;
  const invite = rows[0] as
    | {
        id: string;
        email: string;
        role: string;
        status: string;
        org_id: string;
        org_name: string;
      }
    | undefined;

  if (!invite) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Invitation not found
        </h1>
        <p
          data-testid="accept-invite-error"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
        >
          This invite link is not valid.
        </p>
        <Link
          href="/orgs"
          className="mt-6 inline-flex text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          Go to your organizations
        </Link>
      </Shell>
    );
  }

  if (invite.status !== "pending") {
    return (
      <Shell>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">
          Invitation to{" "}
          <span data-testid="accept-invite-org-name">{invite.org_name}</span>
        </h1>
        <p
          data-testid="accept-invite-error"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
        >
          {invite.status === "revoked"
            ? "This invite has been revoked."
            : "This invite has already been accepted."}
        </p>
        <Link
          href="/orgs"
          className="mt-6 inline-flex text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          Go to your organizations
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">
        You&apos;ve been invited to{" "}
        <span data-testid="accept-invite-org-name">{invite.org_name}</span>
      </h1>
      <p className="mt-1.5 text-sm text-slate-500">
        Joining as <strong>{ROLE_LABEL[invite.role] ?? invite.role}</strong>,
        signed in as {user.email}.
      </p>
      <div className="mt-6">
        <AcceptInvite token={token} orgId={invite.org_id} />
      </div>
    </Shell>
  );
}
