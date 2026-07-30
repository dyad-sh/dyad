import { redirect } from "next/navigation";
import { CannedResponses } from "@/components/canned-responses";
import { dashboardPath, getCurrentUser } from "@/lib/current-user";
export const dynamic = "force-dynamic";
export default async function CannedPage() { const user = await getCurrentUser(); if (!user) redirect("/auth/sign-in"); if (user.role !== "admin") redirect(dashboardPath(user.role)); return <CannedResponses />; }
