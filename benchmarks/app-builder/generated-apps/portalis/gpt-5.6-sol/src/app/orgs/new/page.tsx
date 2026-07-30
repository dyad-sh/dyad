import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOrgForm } from "@/components/create-org-form";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NewOrganizationPage() {
  await requireUser();
  return <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6"><Link href="/orgs" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"><ArrowLeft className="size-4" />Back to organizations</Link><Card className="bg-white shadow-sm"><CardHeader><CardTitle className="text-2xl">Create an organization</CardTitle><CardDescription>Set up a new workspace for your team.</CardDescription></CardHeader><CardContent><CreateOrgForm /></CardContent></Card></main>;
}
