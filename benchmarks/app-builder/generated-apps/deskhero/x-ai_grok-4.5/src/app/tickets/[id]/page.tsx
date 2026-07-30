"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { OverdueBadge } from "@/components/overdue-badge";
import { PriorityBadge, StatusBadge } from "@/components/priority-badge";
import { TicketForm } from "@/components/ticket-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Role } from "@/lib/roles";
import { toDatetimeLocalValue } from "@/lib/sla";
import type {
  CannedResponse,
  Ticket,
  TicketNote,
  TicketReply,
  TicketStatus,
} from "@/lib/tickets";

type MeResponse = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

type TicketDetail = Ticket & {
  allowed_transitions?: TicketStatus[];
};

type AgentOption = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

const TRANSITION_LABELS: Record<TicketStatus, string> = {
  open: "Reopen / set open",
  in_progress: "Start progress",
  resolved: "Mark resolved",
  closed: "Close",
};

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const ticketId = params.id;

  const [me, setMe] = useState<MeResponse | null>(null);
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [notes, setNotes] = useState<TicketNote[]>([]);
  const [replies, setReplies] = useState<TicketReply[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [notePending, setNotePending] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replyPending, setReplyPending] = useState(false);
  const [slaInput, setSlaInput] = useState("");
  const [cannedValue, setCannedValue] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await fetch("/api/me");
      if (!meRes.ok) {
        if (meRes.status === 403) {
          window.location.href = "/account-deactivated";
          return;
        }
        throw new Error("Failed to load session");
      }
      const meData = (await meRes.json()) as MeResponse;
      setMe(meData);

      const ticketRes = await fetch(`/api/tickets/${ticketId}`);
      if (!ticketRes.ok) {
        const data = (await ticketRes.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Ticket not found");
      }
      const ticketData = (await ticketRes.json()) as TicketDetail;
      setTicket(ticketData);
      setSlaInput(toDatetimeLocalValue(ticketData.sla_due_at));

      const canReply =
        meData.role === "admin" ||
        (meData.role === "agent" && ticketData.assignee_id === meData.id) ||
        (meData.role === "requester" && ticketData.creator_id === meData.id);

      const requests: Promise<Response | null>[] = [
        canReply
          ? fetch(`/api/tickets/${ticketId}/replies`)
          : Promise.resolve(null),
      ];

      if (meData.role === "admin" || meData.role === "agent") {
        requests.push(fetch(`/api/tickets/${ticketId}/notes`));
        requests.push(fetch("/api/canned-responses"));
        if (meData.role === "admin") {
          requests.push(fetch("/api/agents"));
        }
      }

      const responses = await Promise.all(requests);
      const repliesRes = responses[0];
      if (repliesRes?.ok) {
        setReplies((await repliesRes.json()) as TicketReply[]);
      } else {
        setReplies([]);
      }

      if (meData.role === "admin" || meData.role === "agent") {
        const notesRes = responses[1];
        const cannedRes = responses[2];
        if (notesRes?.ok) {
          setNotes((await notesRes.json()) as TicketNote[]);
        } else {
          setNotes([]);
        }
        if (cannedRes?.ok) {
          setCanned((await cannedRes.json()) as CannedResponse[]);
        } else {
          setCanned([]);
        }
        if (meData.role === "admin") {
          const agentsRes = responses[3];
          if (agentsRes?.ok) {
            setAgents((await agentsRes.json()) as AgentOption[]);
          } else {
            setAgents([]);
          }
        }
      } else {
        setNotes([]);
        setCanned([]);
        setAgents([]);
      }
    } catch (err) {
      setTicket(null);
      setError(err instanceof Error ? err.message : "Ticket not found");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const allowed = useMemo(
    () => new Set(ticket?.allowed_transitions ?? []),
    [ticket],
  );

  const isRequester = me?.role === "requester";
  const isAdmin = me?.role === "admin";
  const isAgent = me?.role === "agent";
  const isStaff = isAdmin || isAgent;
  const canEditFields =
    !!me &&
    !!ticket &&
    (isAdmin || (isRequester && ticket.creator_id === me.id));
  const canDelete = canEditFields;
  const canSelfAssign = !!me && !!ticket && isAgent && !ticket.assignee_id;
  const canReply =
    !!me &&
    !!ticket &&
    (isAdmin ||
      (isAgent && ticket.assignee_id === me.id) ||
      (isRequester && ticket.creator_id === me.id));

  async function patchTicket(payload: Record<string, unknown>) {
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | (TicketDetail & { error?: string })
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          data && "error" in data && data.error
            ? data.error
            : "Failed to update ticket",
        );
      }

      const updated = data as TicketDetail;
      setTicket(updated);
      setSlaInput(toDatetimeLocalValue(updated.sla_due_at));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update ticket");
    } finally {
      setActionPending(false);
    }
  }

  async function transitionTo(to: TicketStatus) {
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tickets/${ticketId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      const data = (await response.json().catch(() => null)) as
        | (TicketDetail & { error?: string })
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          data && "error" in data && data.error
            ? data.error
            : "Failed to transition ticket",
        );
      }
      const updated = data as TicketDetail;
      setTicket(updated);
      setSlaInput(toDatetimeLocalValue(updated.sla_due_at));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to transition ticket",
      );
    } finally {
      setActionPending(false);
    }
  }

  async function deleteTicket() {
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "Failed to delete ticket");
      }
      router.push("/tickets");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete ticket");
      setActionPending(false);
    }
  }

  async function submitNote(event: FormEvent) {
    event.preventDefault();
    const body = noteBody.trim();
    if (!body) return;

    setNotePending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tickets/${ticketId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await response.json().catch(() => null)) as
        | (TicketNote & { error?: string })
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          data && "error" in data && data.error
            ? data.error
            : "Failed to add note",
        );
      }
      setNotes((prev) => [...prev, data as TicketNote]);
      setNoteBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add note");
    } finally {
      setNotePending(false);
    }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    const body = replyBody.trim();
    if (!body) return;

    setReplyPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tickets/${ticketId}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await response.json().catch(() => null)) as
        | (TicketReply & { error?: string })
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          data && "error" in data && data.error
            ? data.error
            : "Failed to add reply",
        );
      }
      setReplies((prev) => [...prev, data as TicketReply]);
      setReplyBody("");
      setCannedValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add reply");
    } finally {
      setReplyPending(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading ticket...</p>;
  }

  if (!ticket || !me) {
    return (
      <div className="space-y-4">
        <Link
          href="/tickets"
          className="inline-flex items-center text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Ticket not found</CardTitle>
            <CardDescription>
              {error ?? "This ticket does not exist or you cannot view it."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const backHref =
    me.role === "admin" ? "/admin" : me.role === "agent" ? "/agent" : "/tickets";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={backHref}
          className="mb-4 inline-flex items-center text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1
              data-testid="ticket-detail-subject"
              className="text-3xl font-semibold tracking-tight text-slate-900"
            >
              {ticket.subject}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Created {new Date(ticket.created_at).toLocaleString()}
              {ticket.creator_email ? ` by ${ticket.creator_email}` : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ticket.overdue ? <OverdueBadge /> : null}
            <span data-testid="ticket-detail-priority">
              <PriorityBadge priority={ticket.priority} />
            </span>
            <span data-testid="ticket-detail-status">
              <StatusBadge status={ticket.status} />
            </span>
          </div>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Details</CardTitle>
          <CardDescription>
            {isRequester
              ? "You can edit the request contents and join the public conversation."
              : "Manage assignment, SLA, workflow, and collaboration."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Assignee
              </p>
              <p
                data-testid="ticket-assignee"
                className="mt-1 text-sm text-slate-800"
              >
                {ticket.assignee_email ?? "Unassigned"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                SLA due
              </p>
              <p data-testid="sla-due" className="mt-1 text-sm text-slate-800">
                {new Date(ticket.sla_due_at).toLocaleString()}
              </p>
            </div>
            {isAdmin ? (
              <div className="space-y-2">
                <label
                  htmlFor="assignee-select"
                  className="text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  Assign agent
                </label>
                <select
                  id="assignee-select"
                  data-testid="assignee-select"
                  disabled={actionPending}
                  value={ticket.assignee_id ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    void patchTicket({
                      assigneeId: value === "" ? null : value,
                    });
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name || agent.email} ({agent.role})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {isAdmin ? (
              <div className="space-y-2">
                <label
                  htmlFor="sla-due-input"
                  className="text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  Edit SLA due
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="sla-due-input"
                    data-testid="sla-due-input"
                    type="datetime-local"
                    value={slaInput}
                    onChange={(event) => setSlaInput(event.target.value)}
                    disabled={actionPending}
                  />
                  <Button
                    type="button"
                    data-testid="sla-due-save"
                    disabled={actionPending || !slaInput}
                    onClick={() => {
                      const parsed = new Date(slaInput);
                      if (Number.isNaN(parsed.getTime())) {
                        setError("Invalid SLA due time");
                        return;
                      }
                      void patchTicket({ slaDueAt: parsed.toISOString() });
                    }}
                  >
                    Save SLA
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {editing && canEditFields ? (
            <TicketForm
              initialSubject={ticket.subject}
              initialBody={ticket.body}
              initialPriority={ticket.priority}
              submitLabel="Save changes"
              pendingLabel="Saving..."
              onSubmit={async (values) => {
                const response = await fetch(`/api/tickets/${ticketId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(values),
                });
                const data = (await response.json().catch(() => null)) as
                  | (TicketDetail & { error?: string })
                  | { error?: string }
                  | null;
                if (!response.ok) {
                  throw new Error(
                    data && "error" in data && data.error
                      ? data.error
                      : "Failed to update ticket",
                  );
                }
                const updated = data as TicketDetail;
                setTicket(updated);
                setSlaInput(toDatetimeLocalValue(updated.sla_due_at));
                setEditing(false);
              }}
            />
          ) : (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Body
              </p>
              <p
                data-testid="ticket-detail-body"
                className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800"
              >
                {ticket.body || "No additional details provided."}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            {canEditFields ? (
              !editing ? (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="ticket-edit"
                  disabled={actionPending}
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={actionPending}
                  onClick={() => setEditing(false)}
                >
                  Cancel edit
                </Button>
              )
            ) : null}

            {canSelfAssign ? (
              <Button
                type="button"
                variant="secondary"
                data-testid="assign-to-me"
                disabled={actionPending}
                onClick={() => void patchTicket({ assigneeId: me.id })}
              >
                Assign to me
              </Button>
            ) : null}

            {allowed.has("open") ? (
              <Button
                type="button"
                variant="secondary"
                data-testid="transition-open"
                disabled={actionPending}
                onClick={() => void transitionTo("open")}
              >
                {TRANSITION_LABELS.open}
              </Button>
            ) : null}
            {allowed.has("in_progress") ? (
              <Button
                type="button"
                variant="secondary"
                data-testid="transition-in_progress"
                disabled={actionPending}
                onClick={() => void transitionTo("in_progress")}
              >
                {TRANSITION_LABELS.in_progress}
              </Button>
            ) : null}
            {allowed.has("resolved") ? (
              <Button
                type="button"
                variant="secondary"
                data-testid="transition-resolved"
                disabled={actionPending}
                onClick={() => void transitionTo("resolved")}
              >
                {TRANSITION_LABELS.resolved}
              </Button>
            ) : null}
            {allowed.has("closed") ? (
              <Button
                type="button"
                variant="secondary"
                data-testid="transition-closed"
                disabled={actionPending}
                onClick={() => void transitionTo("closed")}
              >
                {TRANSITION_LABELS.closed}
              </Button>
            ) : null}

            {canDelete ? (
              <Button
                type="button"
                variant="destructive"
                data-testid="ticket-delete"
                disabled={actionPending}
                onClick={() => void deleteTicket()}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {canReply ? (
        <Card className="border-slate-200/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Conversation</CardTitle>
            <CardDescription>
              Public replies shared with the requester and assigned staff.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {replies.length === 0 ? (
              <p className="text-sm text-slate-500">No replies yet.</p>
            ) : (
              <ul className="space-y-3">
                {replies.map((reply) => (
                  <li
                    key={reply.id}
                    data-testid="reply-item"
                    className="rounded-lg border bg-white px-3 py-3"
                  >
                    <p className="whitespace-pre-wrap text-sm text-slate-800">
                      {reply.body}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {reply.author_email ?? reply.author_id} ·{" "}
                      {new Date(reply.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <form className="space-y-3" onSubmit={submitReply}>
              {isStaff && canned.length > 0 ? (
                <select
                  data-testid="canned-select"
                  value={cannedValue}
                  onChange={(event) => {
                    const id = event.target.value;
                    setCannedValue(id);
                    const selected = canned.find((item) => item.id === id);
                    if (selected) {
                      setReplyBody(selected.body);
                    }
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Insert canned response…</option>
                  {canned.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              ) : isStaff ? (
                <select
                  data-testid="canned-select"
                  value=""
                  disabled
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">No canned responses</option>
                </select>
              ) : null}
              <Textarea
                data-testid="reply-input"
                value={replyBody}
                onChange={(event) => setReplyBody(event.target.value)}
                placeholder="Write a public reply"
                rows={4}
                disabled={replyPending}
              />
              <Button
                type="submit"
                data-testid="reply-submit"
                disabled={replyPending || !replyBody.trim()}
              >
                {replyPending ? "Sending..." : "Send reply"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {isStaff ? (
        <Card
          data-testid="notes-section"
          className="border-slate-200/80 shadow-sm"
        >
          <CardHeader>
            <CardTitle className="text-lg">Internal notes</CardTitle>
            <CardDescription>
              Visible only to agents and admins. Requesters never receive these.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {notes.length === 0 ? (
              <p className="text-sm text-slate-500">No internal notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {notes.map((note) => (
                  <li
                    key={note.id}
                    data-testid="note-item"
                    className="rounded-lg border bg-slate-50/80 px-3 py-3"
                  >
                    <p className="whitespace-pre-wrap text-sm text-slate-800">
                      {note.body}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {note.author_email ?? note.author_id} ·{" "}
                      {new Date(note.created_at).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <form className="space-y-3" onSubmit={submitNote}>
              <Textarea
                data-testid="note-input"
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                placeholder="Add an internal note for the team"
                rows={3}
                disabled={notePending}
              />
              <Button
                type="submit"
                data-testid="note-submit"
                disabled={notePending || !noteBody.trim()}
              >
                {notePending ? "Saving..." : "Add note"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
