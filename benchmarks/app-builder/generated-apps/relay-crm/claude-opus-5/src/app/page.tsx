import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  redirect(user ? "/contacts" : "/auth/sign-in");
}
