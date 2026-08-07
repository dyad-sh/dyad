import { redirect } from "next/navigation";
import { sessionUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await sessionUser();
  redirect(user ? "/bookings" : "/auth/sign-in");
}
