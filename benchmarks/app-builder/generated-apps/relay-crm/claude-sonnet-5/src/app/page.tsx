import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? "/contacts" : "/auth/sign-in");
}
