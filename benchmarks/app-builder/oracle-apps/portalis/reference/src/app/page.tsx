import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const user = await getSessionUser();
  redirect(user ? "/orgs" : "/auth/sign-in");
}
