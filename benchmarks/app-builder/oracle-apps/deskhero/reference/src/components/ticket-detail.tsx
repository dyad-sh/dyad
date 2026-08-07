"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { AppUser, isOverdue, Ticket, TicketStatus } from "@/lib/tickets";
import { statusControls } from "@/lib/workflow";
import { TicketForm } from "@/components/ticket-form";

type Note = { id: string; body: string; author_name: string };
type Reply = {
  id: string;
  body: string;
  author_name: string;
  created_at: string;
};
type Canned = { id: string; title: string; body: string };

/** `<input type="datetime-local">` wants local wall-clock, not UTC. */
function toLocalInputValue(iso: string) {
  const when = new Date(iso);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

export function TicketDetail({ id }: { id: string }) {
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [agents, setAgents] = useState<AppUser[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [canned, setCanned] = useState<Canned[] | null>(null);
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [slaDraft, setSlaDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch(`/api/tickets/${id}`).then(async (response) => {
      if (response.ok) setTicket(await response.json());
      else setMissing(true);
    });
  }, [id]);

  useEffect(() => {
    fetch("/api/me")
      .then(async (response) => (response.ok ? response.json() : null))
      .then((me: AppUser | null) => {
        setUser(me);
        if (!me) return;
        if (me.role === "admin") {
          fetch("/api/admin/users")
            .then(async (response) => (response.ok ? response.json() : []))
            .then((users: AppUser[]) =>
              setAgents(users.filter((it) => it.role === "agent" && it.active)),
            );
        }
        // Internal notes and canned responses are staff-only: the requester's
        // browser never even asks for them, and the server refuses anyway.
        if (me.role !== "requester") {
          fetch(`/api/tickets/${id}/notes`)
            .then(async (response) => (response.ok ? response.json() : []))
            .then(setNotes);
          fetch("/api/canned-responses")
            .then(async (response) => (response.ok ? response.json() : []))
            .then(setCanned);
        }
      });
  }, [id]);

  const canReply =
    !!ticket &&
    !!user &&
    (user.role === "admin" ||
      ticket.creator_id === user.id ||
      ticket.assignee_id === user.id);

  useEffect(() => {
    if (!canReply) return;
    fetch(`/api/tickets/${id}/replies`)
      .then(async (response) => (response.ok ? response.json() : []))
      .then(setReplies);
  }, [id, canReply]);

  const patch = useCallback(
    async (data: object) => {
      const response = await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) return;
      const updated = await response.json();
      setTicket((current) => (current ? { ...current, ...updated } : current));
    },
    [id],
  );

  async function transition(to: TicketStatus) {
    const response = await fetch(`/api/tickets/${id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    });
    if (!response.ok) return;
    const updated = await response.json();
    setTicket((current) => (current ? { ...current, ...updated } : current));
  }

  async function addNote() {
    if (!note.trim()) return;
    const response = await fetch(`/api/tickets/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: note }),
    });
    if (!response.ok) return;
    const created = await response.json();
    setNotes((current) => [...current, created]);
    setNote("");
  }

  async function addReply() {
    if (!reply.trim()) return;
    const response = await fetch(`/api/tickets/${id}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: reply }),
    });
    if (!response.ok) return;
    const created = await response.json();
    setReplies((current) => [...current, created]);
    setReply("");
  }

  async function remove() {
    const response = await fetch(`/api/tickets/${id}`, { method: "DELETE" });
    if (response.ok) router.push("/tickets");
  }

  if (missing) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-2xl font-bold text-slate-950">Ticket not found</h1>
        <p className="mt-2 text-sm text-slate-500">
          This ticket does not exist, or it is not yours.
        </p>
      </main>
    );
  }
  if (!ticket || !user) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-12 text-sm text-slate-500">
        Loading ticket…
      </main>
    );
  }

  const isAdmin = user.role === "admin";
  const isOwner = ticket.creator_id === user.id;
  // The buttons come from the same module the server checks against, so UI
  // gating cannot drift from enforcement: a viewer only ever sees the controls
  // for transitions the server would actually let them perform.
  const controls = statusControls(ticket.status, !!ticket.assignee_id, {
    role: user.role,
    isOwner,
    isAssignee: ticket.assignee_id === user.id,
  });
  const home = isAdmin
    ? "/admin"
    : user.role === "agent"
      ? "/agent"
      : "/tickets";
  const slaIso = new Date(ticket.sla_due_at).toISOString();

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <Link href={home} className="text-sm font-medium text-cyan-700">
        ← Back
      </Link>
      <section className="mt-7 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {editing ? (
          <>
            <button
              onClick={() => setEditing(false)}
              className="text-sm text-slate-500"
            >
              Cancel
            </button>
            <div className="mt-5">
              <TicketForm
                ticket={ticket}
                onSaved={(updated) => {
                  setTicket((current) =>
                    current ? { ...current, ...updated } : current,
                  );
                  setEditing(false);
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between gap-4">
              <div>
                <div className="flex flex-wrap gap-2">
                  <span
                    data-testid="ticket-detail-status"
                    className="rounded-full bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700"
                  >
                    {ticket.status}
                  </span>
                  <span
                    data-testid="ticket-detail-priority"
                    className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
                  >
                    {ticket.priority}
                  </span>
                  {isOverdue(ticket) && (
                    <span
                      data-testid="overdue-badge"
                      className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                    >
                      Overdue
                    </span>
                  )}
                </div>
                <h1
                  data-testid="ticket-detail-subject"
                  className="mt-4 text-2xl font-bold tracking-tight text-slate-950"
                >
                  {ticket.subject}
                </h1>
              </div>
              {(isOwner || isAdmin) && (
                <button
                  data-testid="ticket-edit"
                  onClick={() => setEditing(true)}
                  className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Pencil className="size-4" />
                  Edit
                </button>
              )}
            </div>
            <p
              data-testid="ticket-detail-body"
              className="mt-6 whitespace-pre-wrap text-slate-600"
            >
              {ticket.body || "No additional details provided."}
            </p>

            <div className="mt-6 rounded-lg bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                SLA due
              </p>
              <p
                data-testid="sla-due"
                className="mt-1 font-medium text-slate-800"
              >
                {new Date(ticket.sla_due_at).toLocaleString()}
                {/* machine-readable duplicate for tooling/screen readers */}
                <span className="sr-only"> {slaIso}</span>
              </p>
              {isAdmin && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    data-testid="sla-due-input"
                    type="datetime-local"
                    value={slaDraft ?? toLocalInputValue(ticket.sla_due_at)}
                    onChange={(event) => setSlaDraft(event.target.value)}
                    className="rounded border border-slate-200 px-2 py-1 text-sm"
                  />
                  <button
                    data-testid="sla-due-save"
                    onClick={() => {
                      const draft = slaDraft
                        ? new Date(slaDraft).toISOString()
                        : ticket.sla_due_at;
                      setSlaDraft(null);
                      return patch({ slaDueAt: draft });
                    }}
                    className="rounded bg-cyan-600 px-3 py-1 text-sm font-semibold text-white hover:bg-cyan-700"
                  >
                    Save due time
                  </button>
                </div>
              )}
            </div>

            <div
              data-testid="ticket-assignee"
              className="mt-4 rounded-lg bg-slate-50 p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Assignee
              </p>
              {isAdmin ? (
                // Rendered only once the agent roster has arrived: a select
                // that exists but has no options yet is a trap for anything
                // (person or script) that picks an option as soon as it sees
                // the control.
                agents === null ? (
                  <p className="mt-2 text-sm text-slate-500">Loading agents…</p>
                ) : (
                  <select
                    data-testid="assignee-select"
                    value={ticket.assignee_id ?? ""}
                    onChange={(event) =>
                      patch({ assigneeId: event.target.value || null })
                    }
                    className="mt-2 rounded border border-slate-200 bg-white px-2 py-1 text-sm"
                  >
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                )
              ) : (
                <>
                  <p className="mt-1 text-slate-800">
                    {ticket.assignee_name ||
                      ticket.assignee_email ||
                      "Unassigned"}
                  </p>
                  {user.role === "agent" && !ticket.assignee_id && (
                    <button
                      data-testid="assign-to-me"
                      onClick={() => patch({ assigneeId: user.id })}
                      className="mt-2 text-sm font-semibold text-cyan-700"
                    >
                      Assign to me
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {controls.map((control) => (
                <button
                  key={control.testId}
                  data-testid={control.testId}
                  onClick={() => transition(control.to)}
                  className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  {control.label}
                </button>
              ))}
              {(isOwner || isAdmin) && (
                <button
                  data-testid="ticket-delete"
                  onClick={remove}
                  className="inline-flex items-center gap-2 rounded border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="size-4" />
                  Delete
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {canReply && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-slate-950">Conversation</h2>
          <div className="mt-4 space-y-3">
            {replies.map((item) => (
              <article
                data-testid="reply-item"
                key={item.id}
                className="rounded-lg bg-slate-50 p-3"
              >
                <p className="whitespace-pre-wrap text-slate-800">
                  {item.body}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {item.author_name}
                </p>
              </article>
            ))}
          </div>
          {user.role !== "requester" && canned !== null && (
            <select
              data-testid="canned-select"
              className="mt-4 rounded border border-slate-200 bg-white px-2 py-1 text-sm"
              value=""
              onChange={(event) => {
                const picked = canned.find(
                  (item) => item.id === event.target.value,
                );
                if (picked) setReply(picked.body);
              }}
            >
              <option value="">Use a canned response…</option>
              {canned.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          )}
          <textarea
            data-testid="reply-input"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            className="mt-3 w-full rounded border border-slate-200 p-2"
            rows={3}
            placeholder="Write a reply"
          />
          <button
            data-testid="reply-submit"
            onClick={addReply}
            className="mt-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700"
          >
            Send reply
          </button>
        </section>
      )}

      {user.role !== "requester" && (
        <section
          data-testid="notes-section"
          className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="font-semibold text-slate-950">Internal notes</h2>
          <p className="mt-1 text-xs text-slate-500">
            Only agents and admins can read these.
          </p>
          {notes.map((item) => (
            <article
              data-testid="note-item"
              key={item.id}
              className="mt-3 rounded bg-amber-50 p-3"
            >
              <p className="whitespace-pre-wrap text-slate-800">{item.body}</p>
              <p className="mt-1 text-xs text-slate-500">{item.author_name}</p>
            </article>
          ))}
          <textarea
            data-testid="note-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-4 w-full rounded border border-slate-200 p-2"
            rows={3}
            placeholder="Add an internal note"
          />
          <button
            data-testid="note-submit"
            onClick={addNote}
            className="mt-2 rounded bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700"
          >
            Add note
          </button>
        </section>
      )}
    </main>
  );
}
