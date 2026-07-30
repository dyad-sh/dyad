"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { TicketForm } from "@/components/ticket-form";
import {
  OverdueBadge,
  PriorityBadge,
  StatusBadge,
} from "@/components/ticket-badges";
import {
  TRANSITIONS,
  canTransition,
  isOverdue,
  type CannedResponse,
  type Role,
  type Status,
  type Ticket,
  type TicketNote,
  type TicketReply,
} from "@/lib/tickets";
import {
  ArrowLeft,
  Clock,
  MessageSquare,
  Pencil,
  StickyNote,
  Trash2,
  UserCheck,
} from "lucide-react";

type Me = { id: string; email: string; name: string; role: Role };
type UserRow = { id: string; name: string; email: string; role: Role };

const TRANSITION_LABELS: Record<Status, string> = {
  open: "Reopen",
  in_progress: "Start progress",
  resolved: "Resolve",
  closed: "Close",
};

export default function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [notes, setNotes] = useState<TicketNote[] | null>(null);
  const [replies, setReplies] = useState<TicketReply[] | null>(null);
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [agents, setAgents] = useState<UserRow[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [replyText, setReplyText] = useState("");
  const [slaInput, setSlaInput] = useState("");

  useEffect(() => {
    const load = async () => {
      const meRes = await fetch("/api/me");
      if (!meRes.ok) return;
      const meData: Me = await meRes.json();
      setMe(meData);

      const ticketRes = await fetch(`/api/tickets/${id}`);
      if (!ticketRes.ok) {
        setNotFound(true);
        return;
      }
      const ticketData: Ticket = await ticketRes.json();
      setTicket(ticketData);
      setSlaInput(format(new Date(ticketData.sla_due_at), "yyyy-MM-dd'T'HH:mm"));

      const isParticipant =
        meData.role === "admin" ||
        ticketData.user_id === meData.id ||
        ticketData.assignee_id === meData.id;
      if (isParticipant) {
        fetch(`/api/tickets/${id}/replies`)
          .then((res) => (res.ok ? res.json() : []))
          .then(setReplies)
          .catch(() => setReplies([]));
      }
      if (meData.role !== "requester") {
        fetch(`/api/tickets/${id}/notes`)
          .then((res) => (res.ok ? res.json() : []))
          .then(setNotes)
          .catch(() => setNotes([]));
        fetch("/api/canned-responses")
          .then((res) => (res.ok ? res.json() : []))
          .then(setCanned)
          .catch(() => setCanned([]));
      }
      if (meData.role === "admin") {
        fetch("/api/admin/users")
          .then((res) => (res.ok ? res.json() : []))
          .then((users: UserRow[]) =>
            setAgents(users.filter((u) => u.role === "agent")),
          )
          .catch(() => setAgents([]));
      }
    };
    load();
  }, [id]);

  const patchTicket = async (payload: Record<string, unknown>) => {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Could not update ticket.");
      }
      const updated: Ticket = await res.json();
      setTicket(updated);
      setSlaInput(format(new Date(updated.sla_due_at), "yyyy-MM-dd'T'HH:mm"));
      return updated;
    } finally {
      setBusy(false);
    }
  };

  const patchSafely = (payload: Record<string, unknown>) =>
    patchTicket(payload).catch((err) =>
      setActionError(err instanceof Error ? err.message : "Update failed."),
    );

  const transition = async (to: Status) => {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(data?.error ?? "Transition failed.");
        return;
      }
      setTicket(data);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this ticket? This cannot be undone.")) return;
    setBusy(true);
    const res = await fetch(`/api/tickets/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/tickets");
    } else {
      setBusy(false);
    }
  };

  const submitNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteText.trim() }),
      });
      if (res.ok) {
        const note = await res.json();
        setNotes((curr) => [...(curr ?? []), note]);
        setNoteText("");
      }
    } finally {
      setBusy(false);
    }
  };

  const submitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyText.trim() }),
      });
      if (res.ok) {
        const reply = await res.json();
        setReplies((curr) => [...(curr ?? []), reply]);
        setReplyText("");
      }
    } finally {
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-4 text-lg font-medium text-slate-900">
          Ticket not found
        </p>
        <Button asChild variant="outline">
          <Link href="/tickets">Back to tickets</Link>
        </Button>
      </div>
    );
  }

  if (!ticket || !me) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-8 w-2/3 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const isOwner = ticket.user_id === me.id;
  const isAdmin = me.role === "admin";
  const isAgent = me.role === "agent";
  const canEdit = isOwner || isAdmin;
  const isParticipant = isAdmin || isOwner || ticket.assignee_id === me.id;
  const allowedTransitions = TRANSITIONS[ticket.status].filter(
    (to) => canTransition({ role: me.role, userId: me.id, ticket, to }).ok,
  );

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/tickets"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to tickets
      </Link>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {editing ? (
          <>
            <h1 className="mb-6 text-xl font-semibold tracking-tight text-slate-900">
              Edit ticket
            </h1>
            <TicketForm
              initialValues={{
                subject: ticket.subject,
                body: ticket.body,
                priority: ticket.priority,
              }}
              submitLabel="Save changes"
              onSubmit={async (values) => {
                await patchTicket(values);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          </>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between gap-4">
              <h1
                data-testid="ticket-detail-subject"
                className="text-xl font-semibold tracking-tight text-slate-900"
              >
                {ticket.subject}
              </h1>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {isOverdue(ticket) && <OverdueBadge />}
                <PriorityBadge
                  priority={ticket.priority}
                  data-testid="ticket-detail-priority"
                />
                <StatusBadge
                  status={ticket.status}
                  data-testid="ticket-detail-status"
                />
              </div>
            </div>
            <p className="mb-1 text-xs text-slate-400">
              Created {format(new Date(ticket.created_at), "MMM d, yyyy 'at' h:mm a")}
              {ticket.requester_name ? ` by ${ticket.requester_name}` : ""}
            </p>
            <p className="mb-1 text-sm text-slate-600">
              Assignee:{" "}
              <span data-testid="ticket-assignee" className="font-medium">
                {ticket.assignee_name ?? "Unassigned"}
              </span>
            </p>
            <p className="mb-4 flex items-center gap-1.5 text-sm text-slate-600">
              <Clock className="h-4 w-4 text-slate-400" />
              SLA due:{" "}
              <span data-testid="sla-due" className="font-medium">
                {format(new Date(ticket.sla_due_at), "MMM d, yyyy h:mm a")}
              </span>
            </p>

            {isAdmin && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3">
                <span className="text-sm text-slate-600">Edit SLA due:</span>
                <Input
                  type="datetime-local"
                  data-testid="sla-due-input"
                  value={slaInput}
                  onChange={(e) => setSlaInput(e.target.value)}
                  className="h-9 w-auto"
                />
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="sla-due-save"
                  disabled={busy || !slaInput}
                  onClick={() =>
                    patchSafely({
                      slaDueAt: new Date(slaInput).toISOString(),
                    })
                  }
                >
                  Save
                </Button>
              </div>
            )}

            {(isAdmin || (isAgent && !ticket.assignee_id)) && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
                {isAdmin && (
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    Assign to
                    <select
                      data-testid="assignee-select"
                      value={ticket.assignee_id ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        patchSafely({ assigneeId: e.target.value || null })
                      }
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">Unassigned</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} ({agent.email})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {isAgent && !ticket.assignee_id && (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="assign-to-me"
                    disabled={busy}
                    onClick={() => patchSafely({ assigneeId: me.id })}
                  >
                    <UserCheck className="mr-1.5 h-4 w-4" />
                    Assign to me
                  </Button>
                )}
              </div>
            )}

            <p
              data-testid="ticket-detail-body"
              className="mb-6 whitespace-pre-wrap text-sm leading-relaxed text-slate-700"
            >
              {ticket.body || "No description provided."}
            </p>

            {actionError && (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {actionError}
              </p>
            )}

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-5">
              {allowedTransitions.map((to) => (
                <Button
                  key={to}
                  size="sm"
                  data-testid={`transition-${to}`}
                  disabled={busy}
                  onClick={() => transition(to)}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {TRANSITION_LABELS[to]}
                </Button>
              ))}
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="ticket-edit"
                  disabled={busy}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="mr-1.5 h-4 w-4" />
                  Edit
                </Button>
              )}
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="ticket-delete"
                  disabled={busy}
                  onClick={handleDelete}
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      {isParticipant && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-medium text-slate-900">
            <MessageSquare className="h-5 w-5 text-indigo-600" />
            Conversation
          </h2>
          {replies === null ? (
            <Skeleton className="h-16 w-full rounded-lg" />
          ) : replies.length === 0 ? (
            <p className="mb-4 text-sm text-slate-500">No replies yet.</p>
          ) : (
            <ul className="mb-4 space-y-3">
              {replies.map((reply) => (
                <li
                  key={reply.id}
                  data-testid="reply-item"
                  className="rounded-lg bg-slate-50 p-3"
                >
                  <p className="whitespace-pre-wrap text-sm text-slate-700">
                    {reply.content}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {reply.author_name ?? "Unknown"} ·{" "}
                    {format(new Date(reply.created_at), "MMM d, yyyy h:mm a")}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={submitReply} className="space-y-3">
            {me.role !== "requester" && canned.length > 0 && (
              <select
                data-testid="canned-select"
                value=""
                onChange={(e) => {
                  const selected = canned.find((c) => c.id === e.target.value);
                  if (selected) setReplyText(selected.body);
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Insert canned response…</option>
                {canned.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            )}
            <Textarea
              data-testid="reply-input"
              placeholder="Write a reply…"
              rows={3}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              data-testid="reply-submit"
              disabled={busy || !replyText.trim()}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Send reply
            </Button>
          </form>
        </div>
      )}

      {me.role !== "requester" && (
        <div
          data-testid="notes-section"
          className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="mb-4 flex items-center gap-2 text-lg font-medium text-slate-900">
            <StickyNote className="h-5 w-5 text-indigo-600" />
            Internal notes
          </h2>
          {notes === null ? (
            <Skeleton className="h-16 w-full rounded-lg" />
          ) : notes.length === 0 ? (
            <p className="mb-4 text-sm text-slate-500">
              No internal notes yet.
            </p>
          ) : (
            <ul className="mb-4 space-y-3">
              {notes.map((note) => (
                <li
                  key={note.id}
                  data-testid="note-item"
                  className="rounded-lg bg-amber-50/70 p-3"
                >
                  <p className="whitespace-pre-wrap text-sm text-slate-700">
                    {note.content}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {note.author_name ?? "Unknown"} ·{" "}
                    {format(new Date(note.created_at), "MMM d, yyyy h:mm a")}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={submitNote} className="space-y-3">
            <Textarea
              data-testid="note-input"
              placeholder="Add an internal note (never visible to requesters)…"
              rows={3}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              data-testid="note-submit"
              disabled={busy || !noteText.trim()}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              Add note
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
