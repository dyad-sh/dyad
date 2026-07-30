import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { getOptionalUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  const user = await getOptionalUser();
  if (user) {
    redirect("/orgs");
  }

  return (
    <div>
      <div className="mb-6 space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          Create your account
        </h2>
        <p className="text-sm text-muted-foreground">
          Start managing organizations in Portalis.
        </p>
      </div>
      <SignUpForm />
    </div>
  );
}
