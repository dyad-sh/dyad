import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "../auth-shell";
import { SignInForm } from "./sign-in-form";
import { getSessionUser } from "@/lib/orgs";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeNext(next);
  const user = await getSessionUser();
  if (user) redirect(target);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your Portalis admin portal."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href={`/auth/sign-up?next=${encodeURIComponent(target)}`}
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            Create one
          </Link>
        </>
      }
    >
      <SignInForm next={target} />
    </AuthShell>
  );
}
