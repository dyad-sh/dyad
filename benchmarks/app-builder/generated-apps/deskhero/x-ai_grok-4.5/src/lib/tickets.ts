import type { Role } from "@/lib/roles";

export type TicketPriority = "low" | "medium" | "high";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

export type Ticket = {
  id: string;
  subject: string;
  body: string;
  priority: TicketPriority;
  status: TicketStatus;
  creator_id: string;
  assignee_id: string | null;
  created_at: string;
  sla_due_at: string;
  overdue: boolean;
  assignee_name?: string | null;
  assignee_email?: string | null;
  creator_name?: string | null;
  creator_email?: string | null;
};

export type TicketNote = {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author_name?: string | null;
  author_email?: string | null;
};

export type TicketReply = {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author_name?: string | null;
  author_email?: string | null;
};

export type CannedResponse = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

export const PRIORITIES: TicketPriority[] = ["low", "medium", "high"];
export const STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
];

export function isPriority(value: unknown): value is TicketPriority {
  return value === "low" || value === "medium" || value === "high";
}

export function isStatus(value: unknown): value is TicketStatus {
  return (
    value === "open" ||
    value === "in_progress" ||
    value === "resolved" ||
    value === "closed"
  );
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function mapTicket(row: Record<string, unknown>): Ticket {
  const status = row.status as TicketStatus;
  const slaDueAt = toIso(row.sla_due_at);
  const overdue =
    status !== "resolved" &&
    status !== "closed" &&
    !Number.isNaN(new Date(slaDueAt).getTime()) &&
    new Date(slaDueAt).getTime() < Date.now();

  return {
    id: String(row.id),
    subject: String(row.subject),
    body: row.body == null ? "" : String(row.body),
    priority: row.priority as TicketPriority,
    status,
    creator_id: String(row.creator_id),
    assignee_id: row.assignee_id == null ? null : String(row.assignee_id),
    created_at: toIso(row.created_at),
    sla_due_at: slaDueAt,
    overdue,
    assignee_name:
      row.assignee_name == null ? null : String(row.assignee_name),
    assignee_email:
      row.assignee_email == null ? null : String(row.assignee_email),
    creator_name: row.creator_name == null ? null : String(row.creator_name),
    creator_email:
      row.creator_email == null ? null : String(row.creator_email),
  };
}

export function mapNote(row: Record<string, unknown>): TicketNote {
  return {
    id: String(row.id),
    ticket_id: String(row.ticket_id),
    author_id: String(row.author_id),
    body: String(row.body),
    created_at: toIso(row.created_at),
    author_name: row.author_name == null ? null : String(row.author_name),
    author_email: row.author_email == null ? null : String(row.author_email),
  };
}

export function mapReply(row: Record<string, unknown>): TicketReply {
  return {
    id: String(row.id),
    ticket_id: String(row.ticket_id),
    author_id: String(row.author_id),
    body: String(row.body),
    created_at: toIso(row.created_at),
    author_name: row.author_name == null ? null : String(row.author_name),
    author_email: row.author_email == null ? null : String(row.author_email),
  };
}

export function mapCannedResponse(row: Record<string, unknown>): CannedResponse {
  return {
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    created_at: toIso(row.created_at),
  };
}

type TransitionRule = {
  from: TicketStatus;
  to: TicketStatus;
  allowed: (ctx: {
    role: Role;
    userId: string;
    ticket: Ticket;
  }) => boolean;
};

const TRANSITIONS: TransitionRule[] = [
  {
    from: "open",
    to: "in_progress",
    allowed: ({ role, userId, ticket }) => {
      if (!ticket.assignee_id) return false;
      if (role === "admin") return true;
      return role === "agent" && ticket.assignee_id === userId;
    },
  },
  {
    from: "in_progress",
    to: "resolved",
    allowed: ({ role, userId, ticket }) => {
      if (role === "admin") return true;
      return role === "agent" && ticket.assignee_id === userId;
    },
  },
  {
    from: "in_progress",
    to: "open",
    allowed: ({ role, userId, ticket }) => {
      if (role === "admin") return true;
      return role === "agent" && ticket.assignee_id === userId;
    },
  },
  {
    from: "resolved",
    to: "closed",
    allowed: ({ role, userId, ticket }) => {
      if (role === "admin") return true;
      return role === "requester" && ticket.creator_id === userId;
    },
  },
  {
    from: "resolved",
    to: "open",
    allowed: ({ role, userId, ticket }) => {
      if (role === "admin") return true;
      return role === "requester" && ticket.creator_id === userId;
    },
  },
  {
    from: "closed",
    to: "open",
    allowed: ({ role }) => role === "admin",
  },
];

export type TransitionCheck =
  | { ok: true }
  | { ok: false; status: 403 | 422; error: string };

export function checkTransition(options: {
  from: TicketStatus;
  to: TicketStatus;
  role: Role;
  userId: string;
  ticket: Ticket;
}): TransitionCheck {
  const { from, to, role, userId, ticket } = options;
  if (from === to) {
    return { ok: false, status: 422, error: "Ticket is already in that status" };
  }

  const rule = TRANSITIONS.find((item) => item.from === from && item.to === to);
  if (!rule) {
    return { ok: false, status: 422, error: "Illegal status transition" };
  }

  if (from === "open" && to === "in_progress" && !ticket.assignee_id) {
    return {
      ok: false,
      status: 422,
      error: "Assignee must be set before starting progress",
    };
  }

  if (!rule.allowed({ role, userId, ticket })) {
    return {
      ok: false,
      status: 403,
      error: "Not allowed to perform this transition",
    };
  }

  return { ok: true };
}

export function allowedTransitions(options: {
  role: Role;
  userId: string;
  ticket: Ticket;
}): TicketStatus[] {
  return TRANSITIONS.filter(
    (rule) =>
      rule.from === options.ticket.status &&
      rule.allowed({
        role: options.role,
        userId: options.userId,
        ticket: options.ticket,
      }),
  ).map((rule) => rule.to);
}

export function canViewTicket(options: {
  role: Role;
  userId: string;
  ticket: Ticket;
}): boolean {
  const { role, userId, ticket } = options;
  if (role === "admin" || role === "agent") return true;
  return ticket.creator_id === userId;
}

export function canParticipateInTicket(options: {
  role: Role;
  userId: string;
  ticket: Ticket;
}): boolean {
  const { role, userId, ticket } = options;
  if (role === "admin") return true;
  if (role === "agent") return ticket.assignee_id === userId;
  return ticket.creator_id === userId;
}

export function canEditTicketFields(options: {
  role: Role;
  userId: string;
  ticket: Ticket;
}): boolean {
  const { role, userId, ticket } = options;
  if (role === "admin") return true;
  if (role === "requester") return ticket.creator_id === userId;
  return false;
}

export function canDeleteTicket(options: {
  role: Role;
  userId: string;
  ticket: Ticket;
}): boolean {
  return canEditTicketFields(options);
}

export function canAssignTicket(options: {
  role: Role;
  userId: string;
  ticket: Ticket;
  assigneeId: string | null;
}): { ok: true } | { ok: false; status: 403 | 422; error: string } {
  const { role, userId, ticket, assigneeId } = options;

  if (role === "requester") {
    return { ok: false, status: 403, error: "Requesters cannot assign tickets" };
  }

  if (role === "admin") {
    return { ok: true };
  }

  // agent rules: only self-assign unassigned tickets
  if (assigneeId === null) {
    return { ok: false, status: 403, error: "Agents cannot unassign tickets" };
  }
  if (assigneeId !== userId) {
    return { ok: false, status: 403, error: "Agents can only self-assign" };
  }
  if (ticket.assignee_id && ticket.assignee_id !== userId) {
    return { ok: false, status: 403, error: "Ticket is already assigned" };
  }
  return { ok: true };
}
