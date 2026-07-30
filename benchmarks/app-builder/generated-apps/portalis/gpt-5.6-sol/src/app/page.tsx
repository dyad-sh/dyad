import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  redirect((await getCurrentUser()) ? "/orgs" : "/auth/sign-in");
}
