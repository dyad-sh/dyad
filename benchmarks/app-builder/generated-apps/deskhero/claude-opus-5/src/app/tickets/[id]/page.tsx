"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { OverdueBadge } from "@/components/overdue-badge";
import {
  PRIORITY_OPTIONS,
  priorityClasses,
  statusClasses,
  statusLabels,
  type Priority,
  type Ticket,
} from "@/lib/tickets";
import { allowedTransitions, type Status } from "@/lib/workflow";
import { isOverdue, toDateTimeLocal } from "@/lib/sla";
import type { Role } from "@/lib/roles";
import { errorMessage } from "@/lib/error-message";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

type Me = { id: string; email: string; name: string; role: Role };
type Message = {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author_name: string | null;
  author_email: string | null;
};
type AgentOption = { id: string; name: string | null; email: string };
type Canned = { id: string; title: string; body: string };

export default function TicketDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const subjectRef = useRef<HTMLInputElement>(null);

  const [me, setMe] = useState<Me | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [slaInput, setSlaInput] = useState("");

  const [notes, setNotes] = useState<Message[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  const [replies, setReplies] = useState<Message[]>([]);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [canned, setCanned] = useState<Canned[]>([]);

  const [agents, setAgents] = useState<AgentOption[]>([]);

  const applyTicket = useCallback((data: Ticket) => {
    setTicket(data);
    setSubject(data.subject);
    setBody(data.body);
    setPriority(data.priority);
    setSlaInput(toDateTimeLocal(data.sla_due_at));
  }, []);

  const loadNotes = useCallback(async () => {
    const res = await fetch(`/api/tickets/${id}/notes`, { cache: "no-store" });
    if (res.ok) setNotes((await res.json()) as Message[]);
  }, [id]);

  const loadReplies = useCallback(async () => {
    const res = await fetch(`/api/tickets/${id}/replies`, {
      cache: "no-store",
    });
    if (res.ok) setReplies((await res.json()) as Message[]);
  }, [id]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [meRes, ticketRes] = await Promise.all([
        fetch("/api/me", { cache: "no-store" }),
        fetch(`/api/tickets/${id}`, { cache: "no-store" }),
      ]);

      if (meRes.status === 401 || ticketRes.status === 401) {
        window.location.href = "/auth/sign-in";
        return;
      }
      if (!active) return;

      const meData = (await meRes.json()) as Me;
      setMe(meData);

      if (!ticketRes.ok) {
        setMissing(true);
        setLoading(false);
        return;
      }
      applyTicket((await ticketRes.json()) as Ticket);
      setLoading(false);

      await loadReplies();

      if (meData.role !== "requester") {
        await loadNotes();
        const cannedRes = await fetch("/api/canned-responses", {
          cache: "no-store",
        });
        if (cannedRes.ok && active) {
          setCanned((await cannedRes.json()) as Canned[]);
        }
      }
      if (meData.role === "admin") {
        const usersRes = await fetch("/api/admin/users", { cache: "no-store" });
        if (usersRes.ok) {
          const users = (await usersRes.json()) as (AgentOption & {
            role: Role;
          })[];
          if (active) setAgents(users.filter((u) => u.role === "agent"));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [id, applyTicket, loadNotes, loadReplies]);

  async function send(
    url: string,
    method: "PATCH" | "POST",
    payload: Record<string, unknown>,
    fallback: string,
  ) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        window.location.href = "/auth/sign-in";
        return;
      }
      if (res.status === 404) {
        setMissing(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(errorMessage(data, fallback));
        return;
      }
      applyTicket((await res.json()) as Ticket);
    } catch (err) {
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    if (!subject.trim()) {
      setError("Subject is required.");
      return;
    }
    await send(
      `/api/tickets/${id}`,
      "PATCH",
      { subject: subject.trim(), body, priority },
      "Could not save the ticket.",
    );
  }

  async function onDelete() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${id}`, { method: "DELETE" });
      if (res.status === 401) {
        window.location.href = "/auth/sign-in";
        return;
      }
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => null);
        setError(errorMessage(data, "Could not delete the ticket."));
        setBusy(false);
        return;
      }
      router.push("/tickets");
    } catch {
      setError("Could not delete the ticket.");
      setBusy(false);
    }
  }

  async function onAddNote(event: React.FormEvent) {
    event.preventDefault();
    setNoteError(null);
    if (!noteBody.trim()) {
      setNoteError("Note cannot be empty.");
      return;
    }
    const res = await fetch(`/api/tickets/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: noteBody.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setNoteError(errorMessage(data, "Could not add the note."));
      return;
    }
    setNoteBody("");
    await loadNotes();
  }

  async function onAddReply(event: React.FormEvent) {
    event.preventDefault();
    setReplyError(null);
    if (!replyBody.trim()) {
      setReplyError("Reply cannot be empty.");
      return;
    }
    const res = await fetch(`/api/tickets/${id}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: replyBody.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setReplyError(errorMessage(data, "Could not send the reply."));
      return;
    }
    setReplyBody("");
    await loadReplies();
  }

  if (loading) {
    return (
      <div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white" />
    );
  }

  if (missing || !ticket || !me) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-900">Ticket not found</p>
        <p className="mt-1 text-sm text-slate-500">
          It may have been deleted, or it isn&apos;t visible to you.
        </p>
        <Link
          href="/tickets"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to tickets
        </Link>
      </div>
    );
  }

  const transitions = allowedTransitions(ticket.status, {
    role: me.role,
    userId: me.id,
    creatorId: ticket.creator_id,
    assigneeId: ticket.assignee_id,
  });

  const isStaff = me.role !== "requester";
  const isAdmin = me.role === "admin";
  const mayEditFields =
    isAdmin ||
    ticket.creator_id === me.id ||
    (me.role === "agent" && ticket.assignee_id === me.id);
  const mayDelete = isAdmin || ticket.creator_id === me.id;
  const canSelfAssign = me.role === "agent" && !ticket.assignee_id;
  const isParticipant =
    isAdmin ||
    ticket.creator_id === me.id ||
    (me.role === "agent" && ticket.assignee_id === me.id);

  const assigneeLabel = ticket.assignee_id
    ? ticket.assignee_name || ticket.assignee_email || ticket.assignee_id
    : "Unassigned";

  return (
    <div>
      <Link
        href="/tickets"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to tickets
      </Link>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1
          data-testid="ticket-detail-subject"
          className="text-2xl font-semibold tracking-tight text-slate-900"
        >
          {ticket.subject}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            data-testid="ticket-detail-status"
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClasses[ticket.status]}`}
          >
            {statusLabels[ticket.status]}
          </span>
          <span
            data-testid="ticket-detail-priority"
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${priorityClasses[ticket.priority]}`}
          >
            {ticket.priority}
          </span>
          {isOverdue(ticket) && <OverdueBadge />}
          <span className="text-xs text-slate-500">
            Created {new Date(ticket.created_at).toLocaleString()}
          </span>
        </div>

        <p
          data-testid="ticket-detail-body"
          className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700"
        >
          {ticket.body}
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Assignee
            </p>
            <p
              data-testid="ticket-assignee"
              className="mt-1 text-sm text-slate-900"
            >
              {assigneeLabel}
            </p>

            {isAdmin && (
              <select
                data-testid="assignee-select"
                aria-label="Assign ticket"
                value={ticket.assignee_id ?? ""}
                disabled={busy}
                onChange={(e) =>
                  send(
                    `/api/tickets/${id}`,
                    "PATCH",
                    {
                      assigneeId: e.target.value === "" ? null : e.target.value,
                    },
                    "Could not update the assignee.",
                  )
                }
                className="mt-3 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:opacity-60"
              >
                <option value="">Unassigned</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name || agent.email}
                  </option>
                ))}
              </select>
            )}

            {canSelfAssign && (
              <button
                type="button"
                data-testid="assign-to-me"
                disabled={busy}
                onClick={() =>
                  send(
                    `/api/tickets/${id}`,
                    "PATCH",
                    { assigneeId: me.id },
                    "Could not assign the ticket.",
                  )
                }
                className="mt-3 block rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
              >
                Assign to me
              </button>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              SLA due
            </p>
            <p data-testid="sla-due" className="mt-1 text-sm text-slate-900">
              {ticket.sla_due_at
                ? new Date(ticket.sla_due_at).toLocaleString()
                : "No SLA set"}
            </p>

            {isAdmin && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  data-testid="sla-due-input"
                  type="datetime-local"
                  aria-label="SLA due time"
                  value={slaInput}
                  onChange={(e) => setSlaInput(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
                <button
                  type="button"
                  data-testid="sla-due-save"
                  disabled={busy}
                  onClick={() =>
                    send(
                      `/api/tickets/${id}`,
                      "PATCH",
                      {
                        slaDueAt: slaInput
                          ? new Date(slaInput).toISOString()
                          : null,
                      },
                      "Could not update the SLA due time.",
                    )
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  Save SLA
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-5">
          {transitions.map((status: Status) => (
            <button
              key={status}
              type="button"
              data-testid={`transition-${status}`}
              disabled={busy}
              onClick={() =>
                send(
                  `/api/tickets/${id}/transition`,
                  "POST",
                  { to: status },
                  "Could not update the status.",
                )
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              Move to {statusLabels[status]}
            </button>
          ))}

          {mayEditFields && (
            <button
              type="button"
              data-testid="ticket-edit"
              onClick={() => subjectRef.current?.focus()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          )}

          {mayDelete && (
            <button
              type="button"
              data-testid="ticket-delete"
              disabled={busy}
              onClick={onDelete}
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-60"
            >
              Delete
            </button>
          )}
        </div>

        {error && (
          <p
            data-testid="ticket-error"
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}
      </div>

      {isParticipant && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Conversation
          </h2>

          <ul className="mt-4 space-y-3">
            {replies.length === 0 ? (
              <li className="text-sm text-slate-500">No replies yet.</li>
            ) : (
              replies.map((reply) => (
                <li
                  key={reply.id}
                  data-testid="reply-item"
                  className="rounded-lg border border-slate-200 p-3"
                >
                  <p className="whitespace-pre-wrap text-sm text-slate-800">
                    {reply.body}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {reply.author_name || reply.author_email || "Unknown"} ·{" "}
                    {new Date(reply.created_at).toLocaleString()}
                  </p>
                </li>
              ))
            )}
          </ul>

          <form onSubmit={onAddReply} noValidate className="mt-4 space-y-3">
            {isStaff && (
              <select
                data-testid="canned-select"
                aria-label="Insert canned response"
                value=""
                onChange={(e) => {
                  const picked = canned.find((c) => c.id === e.target.value);
                  if (picked) setReplyBody(picked.body);
                }}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
              >
                <option value="">Insert canned response…</option>
                {canned.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            )}

            <textarea
              data-testid="reply-input"
              rows={3}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Write a reply…"
              className={inputClass}
            />

            {replyError && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {replyError}
              </p>
            )}

            <button
              type="submit"
              data-testid="reply-submit"
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              Send reply
            </button>
          </form>
        </section>
      )}

      {mayEditFields && (
        <form
          onSubmit={onSave}
          noValidate
          className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Edit ticket
          </h2>

          <div className="space-y-1.5">
            <label
              htmlFor="subject"
              className="text-sm font-medium text-slate-700"
            >
              Subject
            </label>
            <input
              id="subject"
              ref={subjectRef}
              data-testid="ticket-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="body"
              className="text-sm font-medium text-slate-700"
            >
              Description
            </label>
            <textarea
              id="body"
              data-testid="ticket-body"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="priority"
              className="text-sm font-medium text-slate-700"
            >
              Priority
            </label>
            <select
              id="priority"
              data-testid="ticket-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className={`${inputClass} appearance-none`}
            >
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            data-testid="ticket-submit"
            disabled={busy}
            className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </form>
      )}

      {isStaff && (
        <section
          data-testid="notes-section"
          className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Internal notes
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Visible to agents and admins only.
          </p>

          <ul className="mt-4 space-y-3">
            {notes.length === 0 ? (
              <li className="text-sm text-slate-500">No notes yet.</li>
            ) : (
              notes.map((note) => (
                <li
                  key={note.id}
                  data-testid="note-item"
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <p className="whitespace-pre-wrap text-sm text-slate-800">
                    {note.body}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {note.author_name || note.author_email || "Unknown"} ·{" "}
                    {new Date(note.created_at).toLocaleString()}
                  </p>
                </li>
              ))
            )}
          </ul>

          <form onSubmit={onAddNote} noValidate className="mt-4 space-y-3">
            <textarea
              data-testid="note-input"
              rows={3}
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Add an internal note…"
              className={inputClass}
            />
            {noteError && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {noteError}
              </p>
            )}
            <button
              type="submit"
              data-testid="note-submit"
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
            >
              Add note
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
