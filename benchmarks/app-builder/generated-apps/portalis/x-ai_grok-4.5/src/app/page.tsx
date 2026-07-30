import { redirect } from "next/navigation";
import { getOptionalUser } from "@/lib/orgs";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getOptionalUser();
  redirect(user ? "/orgs" : "/auth/sign-in");
}
