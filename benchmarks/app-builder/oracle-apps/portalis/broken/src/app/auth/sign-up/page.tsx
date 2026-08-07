import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "../auth-shell";
import { SignUpForm } from "./sign-up-form";
import { getSessionUser } from "@/lib/orgs";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

export default async function SignUpPage({
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
      title="Create your account"
      subtitle="Start managing your organizations in Portalis."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={`/auth/sign-in?next=${encodeURIComponent(target)}`}
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm next={target} />
    </AuthShell>
  );
}
