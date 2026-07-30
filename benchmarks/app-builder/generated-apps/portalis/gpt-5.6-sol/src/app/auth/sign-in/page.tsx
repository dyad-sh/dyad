import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const requested = (await searchParams).next;
  const redirectTo = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/orgs";
  if (await getCurrentUser()) redirect(redirectTo);
  return <AuthForm mode="sign-in" redirectTo={redirectTo} />;
}
