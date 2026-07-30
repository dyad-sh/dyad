import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { getMembership, getOrgById } from "@/lib/orgs";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function OrgSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  const org = await getOrgById(orgId);
  const membership = org
    ? await getMembership(orgId, session.user.id)
    : undefined;

  if (!org || !membership) {
    return null;
  }

  return <SettingsForm orgId={orgId} initialName={org.name} initialDescription={org.description ?? ""} />;
}
