import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { dashboardPath, getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const user = await getCurrentUser();
  if (user) redirect(dashboardPath(user.role));
  return <AuthForm mode="sign-up" />;
}
