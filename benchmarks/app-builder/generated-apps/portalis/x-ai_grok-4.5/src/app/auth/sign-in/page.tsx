import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { getOptionalUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

function safeNextPath(value: string | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  return value;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const sp = await searchParams;
  const nextPath = safeNextPath(sp.next);
  const user = await getOptionalUser();
  if (user) {
    redirect(nextPath ?? "/orgs");
  }

  return (
    <div>
      <div className="mb-6 space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Welcome back</h2>
        <p className="text-sm text-muted-foreground">
          Sign in to access your organizations.
        </p>
      </div>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-md bg-muted" />}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
