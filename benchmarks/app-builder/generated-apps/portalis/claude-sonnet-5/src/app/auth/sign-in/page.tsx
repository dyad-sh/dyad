import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

function isSafeRedirect(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//");
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect: redirectParam } = await searchParams;
  const redirectTo = isSafeRedirect(redirectParam) ? redirectParam : "/orgs";

  const { data: session } = await auth.getSession();
  if (session?.user) {
    redirect(redirectTo);
  }

  return <SignInForm redirectTo={redirectTo} />;
}
