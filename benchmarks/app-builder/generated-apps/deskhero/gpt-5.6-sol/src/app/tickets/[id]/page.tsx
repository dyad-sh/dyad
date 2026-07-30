'use client';

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ClockAlert, Pencil, RotateCcw, Trash2, UserPlus } from "lucide-react";

import { TicketForm } from "@/components/ticket-form";
import { TicketNotes } from "@/components/ticket-notes";
import { TicketReplies } from "@/components/ticket-replies";
import type { CurrentUser } from "@/lib/auth/current-user";
import { isOverdue, type DeskheroUser, type Ticket, type TicketStatus } from "@/lib/tickets";

const statusStyles = { open: "bg-emerald-50 text-emerald-700", in_progress: "bg-blue-50 text-blue-700", resolved: "bg-violet-50 text-violet-700", closed: "bg-slate-100 text-slate-600" };
function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [agents, setAgents] = useState<DeskheroUser[]>([]);
  const [slaInput, setSlaInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([fetch(`/api/tickets/${id}`), fetch("/api/me")]).then(async ([ticketResponse, meResponse]) => {
      const ticketData = await ticketResponse.json();
      const meData = await meResponse.json();
      if (!ticketResponse.ok) throw new Error(ticketData.error ?? "Unable to load ticket");
      if (!meResponse.ok) throw new Error(meData.error ?? "Unable to load account");
      setTicket(ticketData); setSlaInput(localDateTime(ticketData.sla_due_at)); setMe(meData);
      if (meData.role === "admin") {
        const usersResponse = await fetch("/api/admin/users");
        const usersData = await usersResponse.json();
        if (usersResponse.ok) setAgents(usersData.filter((user: DeskheroUser) => user.role === "agent" && user.active));
      }
    }).catch((reason: Error) => setError(reason.message));
  }, [id]);

  async function patchTicket(payload: { assigneeId?: string | null; slaDueAt?: string }) {
    setBusy(true); setError("");
    const response = await fetch(`/api/tickets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (response.ok) { setTicket(data); setSlaInput(localDateTime(data.sla_due_at)); } else setError(data.error ?? "Unable to update ticket");
    setBusy(false);
  }

  async function transition(to: TicketStatus) {
    setBusy(true); setError("");
    const response = await fetch(`/api/tickets/${id}/transition`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to }) });
    const data = await response.json();
    if (response.ok) setTicket(data); else setError(data.error ?? "Unable to update status");
    setBusy(false);
  }

  async function deleteTicket() {
    if (!window.confirm("Delete this ticket? This cannot be undone.")) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/tickets/${id}`, { method: "DELETE" });
    if (response.ok) { router.push("/tickets"); router.refresh(); return; }
    const data = await response.json(); setError(data.error ?? "Unable to delete ticket"); setBusy(false);
  }

  function allowedTransitions(): TicketStatus[] {
    if (!ticket || !me) return [];
    if (me.role === "admin") {
      if (ticket.status === "open") return ticket.assignee_id ? ["in_progress"] : [];
      if (ticket.status === "in_progress") return ["resolved", "open"];
      if (ticket.status === "resolved") return ["closed", "open"];
      return ["open"];
    }
    if (me.role === "agent" && ticket.assignee_id === me.id) {
      if (ticket.status === "open") return ["in_progress"];
      if (ticket.status === "in_progress") return ["resolved", "open"];
    }
    if (me.role === "requester" && ticket.creator_id === me.id && ticket.status === "resolved") return ["closed", "open"];
    return [];
  }

  if (error && !ticket) return <div className="mx-auto max-w-3xl"><Link href="/tickets" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500"><ArrowLeft className="size-4" /> Back to tickets</Link><div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">{error}</div></div>;
  if (!ticket || !me) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading ticket…</div>;

  const transitions = allowedTransitions();
  const owner = ticket.creator_id === me.id;
  const participant = me.role === "admin" || owner || (me.role === "agent" && ticket.assignee_id === me.id);
  const overdue = isOverdue(ticket);

  return <div className="mx-auto max-w-3xl"><Link href="/tickets" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"><ArrowLeft className="size-4" /> Back to tickets</Link><article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    {editing ? <div className="p-6 sm:p-8"><div className="mb-7 border-b border-slate-100 pb-5"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">Edit ticket</p><h1 className="mt-2 text-2xl font-bold text-slate-950">Update request details</h1></div><TicketForm ticket={ticket} onCancel={() => setEditing(false)} onSaved={(updated) => { setTicket(updated); setEditing(false); }} /></div> : <>
      <div className="border-b border-slate-100 p-6 sm:p-8"><div className="mb-5 flex flex-wrap items-center gap-2"><span data-testid="ticket-detail-status" className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusStyles[ticket.status]}`}>{ticket.status.replace("_", " ")}</span><span data-testid="ticket-detail-priority" className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${ticket.priority === "high" ? "bg-red-50 text-red-700" : ticket.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{ticket.priority} priority</span>{overdue && <span data-testid="overdue-badge" className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700"><ClockAlert className="size-3" /> Overdue</span>}</div><h1 data-testid="ticket-detail-subject" className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{ticket.subject}</h1><p className="mt-3 text-xs text-slate-400">Requested by {ticket.creator_name} · {new Date(ticket.created_at).toLocaleString()}</p></div>
      <div className="p-6 sm:p-8"><p data-testid="ticket-detail-body" className="min-h-28 whitespace-pre-wrap text-sm leading-7 text-slate-700">{ticket.body || <span className="italic text-slate-400">No description provided.</span>}</p></div>
      <div className="space-y-5 border-t border-slate-100 bg-slate-50/60 p-6 sm:px-8"><div className="flex flex-wrap items-center gap-3"><span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Assignee</span><span data-testid="ticket-assignee" className="text-sm font-medium text-slate-700">{ticket.assignee_name ?? "Unassigned"}</span>{me.role === "admin" && <select data-testid="assignee-select" value={ticket.assignee_id ?? ""} disabled={busy} onChange={(event) => patchTicket({ assigneeId: event.target.value || null })} className="ml-auto h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500"><option value="">Unassigned</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.email})</option>)}</select>}{me.role === "agent" && !ticket.assignee_id && <button data-testid="assign-to-me" onClick={() => patchTicket({ assigneeId: me.id })} disabled={busy} className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><UserPlus className="size-4" /> Assign to me</button>}</div>
        <div className="flex flex-wrap items-center gap-3"><span className="text-xs font-semibold uppercase tracking-wider text-slate-400">SLA due</span><span data-testid="sla-due" className="text-sm font-medium text-slate-700">{new Date(ticket.sla_due_at).toLocaleString()}</span>{me.role === "admin" && <div className="ml-auto flex items-center gap-2"><input data-testid="sla-due-input" type="datetime-local" value={slaInput} onChange={(event) => setSlaInput(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500" /><button data-testid="sla-due-save" disabled={busy || !slaInput} onClick={() => patchTicket({ slaDueAt: new Date(slaInput).toISOString() })} className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50">Save</button></div>}</div></div>
      {error && <p className="mx-6 mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:mx-8">{error}</p>}
      {(owner || transitions.length > 0) && <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-4 sm:px-8">{owner && <button data-testid="ticket-edit" onClick={() => setEditing(true)} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Pencil className="size-4" /> Edit</button>}{transitions.map((to) => <button key={to} data-testid={`transition-${to}`} onClick={() => transition(to)} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium capitalize text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RotateCcw className="size-4" /> {to.replace("_", " ")}</button>)}{owner && <button data-testid="ticket-delete" onClick={deleteTicket} disabled={busy} className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50"><Trash2 className="size-4" /> Delete</button>}</div>}
      {participant && <TicketReplies ticketId={ticket.id} cannedEnabled={me.role !== "requester"} />}
      {me.role !== "requester" && <TicketNotes ticketId={ticket.id} />}
    </>}
  </article></div>;
}
