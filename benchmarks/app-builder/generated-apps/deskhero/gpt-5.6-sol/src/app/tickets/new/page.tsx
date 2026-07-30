'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { TicketForm } from "@/components/ticket-form";

export default function NewTicketPage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/tickets" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"><ArrowLeft className="size-4" /> Back to tickets</Link>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-7 border-b border-slate-100 pb-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">New request</p>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">Create a ticket</h1>
          <p className="mt-2 text-sm text-slate-500">Tell us what you need and set the right priority.</p>
        </div>
        <TicketForm onSaved={(ticket) => router.push(`/tickets/${ticket.id}`)} />
      </div>
    </div>
  );
}
