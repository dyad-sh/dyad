import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getInviteByToken } from "@/lib/invites";
import { AcceptInviteForm } from "./accept-invite-form";

export const dynamic = "force-dynamic";

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { data: session } = await auth.getSession();

  if (!session?.user) {
    redirect(`/auth/sign-in?redirect=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const invite = await getInviteByToken(token);

  return (
    <AcceptInviteForm
      token={token}
      invite={
        invite ? { org_name: invite.org_name, status: invite.status } : null
      }
    />
  );
}
