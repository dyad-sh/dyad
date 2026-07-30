import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { auth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const { data: session } = await auth.getSession();
  if (session?.user) redirect("/orgs");
  return <AuthForm mode="sign-up" />;
}
