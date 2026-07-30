export const PRIORITIES = ["low", "medium", "high"] as const;
export const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export const ROLES = ["admin", "agent", "requester"] as const;

export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];
export type Role = (typeof ROLES)[number];

export type Ticket = {
  id: string;
  subject: string;
  body: string;
  priority: Priority;
  status: Status;
  created_at: string;
  sla_due_at: string;
  user_id: string;
  assignee_id: string | null;
  assignee_name: string | null;
  requester_name: string | null;
};

export const SLA_HOURS: Record<Priority, number> = {
  high: 4,
  medium: 24,
  low: 72,
};

export function isOverdue(
  ticket: Pick<Ticket, "sla_due_at" | "status">,
): boolean {
  return (
    ticket.status !== "resolved" &&
    ticket.status !== "closed" &&
    new Date(ticket.sla_due_at).getTime() < Date.now()
  );
}

export type TicketReply = {
  id: string;
  content: string;
  created_at: string;
  author_id: string;
  author_name: string | null;
};

export type CannedResponse = {
  id: string;
  title: string;
  body: string;
};

export type TicketNote = {
  id: string;
  content: string;
  created_at: string;
  author_id: string;
  author_name: string | null;
};

export const TRANSITIONS: Record<Status, Status[]> = {
  open: ["in_progress"],
  in_progress: ["resolved", "open"],
  resolved: ["closed", "open"],
  closed: ["open"],
};

export type TransitionCheck = { ok: true } | { ok: false; code: 403 | 422 };

export function canTransition(opts: {
  role: Role;
  userId: string;
  ticket: Pick<Ticket, "status" | "user_id" | "assignee_id">;
  to: Status;
}): TransitionCheck {
  const { role, userId, ticket, to } = opts;
  if (!TRANSITIONS[ticket.status]?.includes(to)) {
    return { ok: false, code: 422 };
  }
  const isAdmin = role === "admin";
  const isAssignedAgent = role === "agent" && ticket.assignee_id === userId;
  const isRequesterOwner = ticket.user_id === userId;

  switch (`${ticket.status}->${to}`) {
    case "open->in_progress":
      if (!isAdmin && !isAssignedAgent) return { ok: false, code: 403 };
      if (!ticket.assignee_id) return { ok: false, code: 422 };
      return { ok: true };
    case "in_progress->resolved":
    case "in_progress->open":
      return isAdmin || isAssignedAgent
        ? { ok: true }
        : { ok: false, code: 403 };
    case "resolved->closed":
    case "resolved->open":
      return isAdmin || isRequesterOwner
        ? { ok: true }
        : { ok: false, code: 403 };
    case "closed->open":
      return isAdmin ? { ok: true } : { ok: false, code: 403 };
    default:
      return { ok: false, code: 422 };
  }
}
