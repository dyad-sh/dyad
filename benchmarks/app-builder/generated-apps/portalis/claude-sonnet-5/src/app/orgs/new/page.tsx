import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { NewOrgForm } from "./new-org-form";

export const dynamic = "force-dynamic";

export default async function NewOrgPage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  return <NewOrgForm />;
}
