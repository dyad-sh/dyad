"use client";

import { useRouter } from "next/navigation";
import { TicketForm } from "@/components/ticket-form";

export default function NewTicketPage() {
  const router = useRouter();
  return <main className="mx-auto max-w-3xl px-6 py-12"><div className="mb-8"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-600">New request</p><h1 className="mt-2 text-4xl font-bold tracking-tight text-slate-950">Create a ticket</h1><p className="mt-2 text-slate-500">Give your team the context they need to help.</p></div><TicketForm onSaved={(ticket) => router.push(`/tickets/${(ticket as { id: string }).id}`)} /></main>;
}
