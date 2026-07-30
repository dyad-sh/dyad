import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { ensureUserWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/auth/sign-in");
  }
  await ensureUserWorkspace(user);
  redirect("/contacts");
}
