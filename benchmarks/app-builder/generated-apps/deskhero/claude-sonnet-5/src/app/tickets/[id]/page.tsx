"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TicketForm, type TicketFormValues } from "@/components/ticket-form";
import { getAllowedTransitions } from "@/lib/ticket-workflow";
import type {
  Ticket,
  TicketNote,
  TicketReply,
  AppUser,
  CannedResponse,
} from "@/types/ticket";

type Me = { id: string; role: "admin" | "agent" | "requester" };

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

function toDateTimeLocal(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [agents, setAgents] = useState<AppUser[]>([]);
  const [notes, setNotes] = useState<TicketNote[]>([]);
  const [noteBody, setNoteBody] = useState("");
  const [replies, setReplies] = useState<TicketReply[] | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
  const [slaDueInput, setSlaDueInput] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setMe);
  }, []);

  useEffect(() => {
    fetch(`/api/tickets/${params.id}`).then(async (res) => {
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const data = await res.json();
      setTicket(data);
      setSlaDueInput(toDateTimeLocal(data.sla_due_at));
    });
  }, [params.id]);

  useEffect(() => {
    if (me?.role === "admin") {
      fetch("/api/admin/users")
        .then((res) => (res.ok ? res.json() : []))
        .then((data: AppUser[]) =>
          setAgents(data.filter((u) => u.role === "agent")),
        );
    }
  }, [me]);

  useEffect(() => {
    if (me && (me.role === "admin" || me.role === "agent")) {
      fetch(`/api/tickets/${params.id}/notes`)
        .then((res) => (res.ok ? res.json() : []))
        .then(setNotes);
      fetch("/api/canned-responses")
        .then((res) => (res.ok ? res.json() : []))
        .then(setCannedResponses);
    }
  }, [me, params.id]);

  useEffect(() => {
    if (!me) return;
    fetch(`/api/tickets/${params.id}/replies`).then(async (res) => {
      if (res.ok) {
        setReplies(await res.json());
      } else {
        setReplies(null);
      }
    });
  }, [me, params.id]);

  const allowedTransitions = useMemo(() => {
    if (!ticket || !me) return [];
    return getAllowedTransitions(ticket.status, {
      role: me.role,
      userId: me.id,
      ownerId: ticket.owner_id,
      assigneeId: ticket.assignee_id,
    });
  }, [ticket, me]);

  async function handleEditSubmit(values: TicketFormValues) {
    const res = await fetch(`/api/tickets/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? "Failed to update ticket.");
    }
    setTicket(await res.json());
    setIsEditing(false);
  }

  async function handleTransition(to: string) {
    setError(null);
    const res = await fetch(`/api/tickets/${params.id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to update status.");
      return;
    }
    setTicket(await res.json());
  }

  async function handleAssigneeChange(assigneeId: string | null) {
    setError(null);
    const res = await fetch(`/api/tickets/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to update assignee.");
      return;
    }
    setTicket(await res.json());
  }

  async function handleAssignToMe() {
    if (!me) return;
    await handleAssigneeChange(me.id);
  }

  async function handleSlaSave() {
    setError(null);
    const iso = new Date(slaDueInput).toISOString();
    const res = await fetch(`/api/tickets/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slaDueAt: iso }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to update SLA due time.");
      return;
    }
    setTicket(await res.json());
  }

  async function handleDelete() {
    const res = await fetch(`/api/tickets/${params.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/tickets");
    } else {
      setError("Failed to delete ticket.");
    }
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteBody.trim()) return;
    const res = await fetch(`/api/tickets/${params.id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: noteBody.trim() }),
    });
    if (res.ok) {
      const note = await res.json();
      setNotes((prev) => [...prev, note]);
      setNoteBody("");
    }
  }

  async function handleAddReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyBody.trim()) return;
    const res = await fetch(`/api/tickets/${params.id}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: replyBody.trim() }),
    });
    if (res.ok) {
      const reply = await res.json();
      setReplies((prev) => [...(prev ?? []), reply]);
      setReplyBody("");
    }
  }

  function handleCannedSelect(id: string) {
    const canned = cannedResponses.find((c) => c.id === id);
    if (canned) {
      setReplyBody(canned.body);
    }
  }

  if (notFound) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">
        Ticket not found.
      </div>
    );
  }

  if (!ticket || !me) {
    return <p className="text-sm text-slate-500">Loading...</p>;
  }

  const isOwner = ticket.owner_id === me.id;
  const canSeeNotes = me.role === "admin" || me.role === "agent";
  const canAssignToMe = me.role === "agent" && ticket.assignee_id === null;
  const canReply = replies !== null;

  if (isEditing) {
    return (
      <div className="mx-auto max-w-xl space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Edit Ticket</h1>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <TicketForm
            initialValues={ticket}
            submitLabel="Save Changes"
            onSubmit={handleEditSubmit}
            onCancel={() => setIsEditing(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <h1
            data-testid="ticket-detail-subject"
            className="text-2xl font-semibold text-slate-900"
          >
            {ticket.subject}
          </h1>
          <div className="flex gap-2">
            {ticket.overdue && (
              <Badge data-testid="overdue-badge" className="bg-red-600 text-white">
                Overdue
              </Badge>
            )}
            <Badge
              data-testid="ticket-detail-priority"
              className="bg-amber-100 text-amber-700"
            >
              {ticket.priority}
            </Badge>
            <Badge data-testid="ticket-detail-status" variant="secondary">
              {STATUS_LABELS[ticket.status]}
            </Badge>
          </div>
        </div>

        <p
          data-testid="ticket-detail-body"
          className="mt-4 whitespace-pre-wrap text-sm text-slate-700"
        >
          {ticket.body || "No description provided."}
        </p>

        <p className="mt-4 text-xs text-slate-400">
          Created {new Date(ticket.created_at).toLocaleString()}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600">
            Assignee:
          </span>
          <span data-testid="ticket-assignee" className="text-sm text-slate-800">
            {ticket.assignee_name ?? "Unassigned"}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600">
            SLA due:
          </span>
          <span data-testid="sla-due" className="text-sm text-slate-800">
            {new Date(ticket.sla_due_at).toLocaleString()}
          </span>
        </div>

        {me.role === "admin" && (
          <div className="mt-3 flex items-end gap-2">
            <div className="space-y-2">
              <Label htmlFor="sla-due-input">Edit SLA due time</Label>
              <Input
                id="sla-due-input"
                type="datetime-local"
                value={slaDueInput}
                onChange={(e) => setSlaDueInput(e.target.value)}
                data-testid="sla-due-input"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSlaSave}
              data-testid="sla-due-save"
            >
              Save
            </Button>
          </div>
        )}

        {me.role === "admin" && (
          <div className="mt-3 space-y-2">
            <Label htmlFor="assignee-select">Reassign</Label>
            <select
              id="assignee-select"
              data-testid="assignee-select"
              value={ticket.assignee_id ?? ""}
              onChange={(e) =>
                handleAssigneeChange(e.target.value === "" ? null : e.target.value)
              }
              className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Unassigned</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {canAssignToMe && (
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAssignToMe}
              data-testid="assign-to-me"
            >
              Assign to me
            </Button>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {isOwner && (
            <Button
              variant="outline"
              onClick={() => setIsEditing(true)}
              data-testid="ticket-edit"
            >
              Edit
            </Button>
          )}
          {allowedTransitions.map((to) => (
            <Button
              key={to}
              variant="outline"
              onClick={() => handleTransition(to)}
              data-testid={`transition-${to}`}
            >
              {STATUS_LABELS[to]}
            </Button>
          ))}
          {isOwner && (
            <Button
              variant="destructive"
              onClick={handleDelete}
              data-testid="ticket-delete"
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {canReply && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-medium text-slate-800">Replies</h2>

          <div className="mt-4 space-y-3">
            {replies.length === 0 ? (
              <p className="text-sm text-slate-500">No replies yet.</p>
            ) : (
              replies.map((reply) => (
                <div
                  key={reply.id}
                  data-testid="reply-item"
                  className="rounded-md bg-slate-50 p-3"
                >
                  <p className="text-sm text-slate-800">{reply.body}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {reply.author_name ?? "Unknown"} &middot;{" "}
                    {new Date(reply.created_at).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>

          {(me.role === "admin" || me.role === "agent") &&
            cannedResponses.length > 0 && (
              <div className="mt-4 space-y-2">
                <Label htmlFor="canned-select">Canned response</Label>
                <select
                  id="canned-select"
                  data-testid="canned-select"
                  defaultValue=""
                  onChange={(e) => handleCannedSelect(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="" disabled>
                    Select a canned response...
                  </option>
                  {cannedResponses.map((canned) => (
                    <option key={canned.id} value={canned.id}>
                      {canned.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

          <form onSubmit={handleAddReply} className="mt-4 space-y-2">
            <Textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              data-testid="reply-input"
              placeholder="Write a reply..."
              rows={3}
            />
            <Button type="submit" size="sm" data-testid="reply-submit">
              Send Reply
            </Button>
          </form>
        </div>
      )}

      {canSeeNotes && (
        <div
          data-testid="notes-section"
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h2 className="text-lg font-medium text-slate-800">
            Internal Notes
          </h2>

          <div className="mt-4 space-y-3">
            {notes.length === 0 ? (
              <p className="text-sm text-slate-500">No notes yet.</p>
            ) : (
              notes.map((note) => (
                <div
                  key={note.id}
                  data-testid="note-item"
                  className="rounded-md bg-slate-50 p-3"
                >
                  <p className="text-sm text-slate-800">{note.body}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {note.author_name ?? "Unknown"} &middot;{" "}
                    {new Date(note.created_at).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleAddNote} className="mt-4 space-y-2">
            <Textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              data-testid="note-input"
              placeholder="Add an internal note..."
              rows={3}
            />
            <Button type="submit" size="sm" data-testid="note-submit">
              Add Note
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
