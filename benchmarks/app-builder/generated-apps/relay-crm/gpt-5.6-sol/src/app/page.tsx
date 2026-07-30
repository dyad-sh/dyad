import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? "/contacts" : "/auth/sign-in");
}
