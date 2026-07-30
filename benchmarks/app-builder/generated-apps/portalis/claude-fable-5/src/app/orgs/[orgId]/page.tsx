import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings, Users } from "lucide-react";
import { auth } from "@/lib/auth/server";
import { getOrgForUser } from "@/lib/orgs";
import { NotAuthorized } from "@/components/not-authorized";
import { OrgShell } from "@/components/org-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function OrgOverviewPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/auth/sign-in");

  const org = await getOrgForUser(orgId, session.user.id);
  if (!org) return <NotAuthorized />;

  return (
    <OrgShell org={org}>
      {org.description && (
        <p className="text-muted-foreground">{org.description}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href={`/orgs/${org.id}/settings`}>
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings className="h-4 w-4" />
                Settings
              </CardTitle>
              <CardDescription>
                Update the organization&apos;s name and description.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href={`/orgs/${org.id}/members`}>
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Members
              </CardTitle>
              <CardDescription>
                See who belongs to this organization.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Your role in this organization:{" "}
          <span className="font-medium text-foreground">{org.role}</span>
        </CardContent>
      </Card>
    </OrgShell>
  );
}
