export type TicketPriority = "low" | "medium" | "high";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

export type Ticket = {
  id: string;
  subject: string;
  body: string;
  priority: TicketPriority;
  status: TicketStatus;
  owner_id: string;
  owner_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  sla_due_at: string;
  overdue: boolean;
  created_at: string;
};

export type TicketNote = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
};

export type TicketReply = {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
};

export type CannedResponse = {
  id: string;
  title: string;
  body: string;
  created_at: string;
};

export type AuditEvent = {
  id: string;
  actor_email: string;
  event_type: "role_change" | "activation_change" | "status_transition";
  target_label: string;
  detail: string;
  created_at: string;
};

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "agent" | "requester";
  active: boolean;
};
