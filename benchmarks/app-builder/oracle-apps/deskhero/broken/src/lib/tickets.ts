export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type Ticket = { id: string; subject: string; body: string; priority: "low" | "medium" | "high"; status: TicketStatus; created_at: string; creator_id: string; assignee_id: string | null; assignee_name?: string | null; assignee_email?: string | null; sla_due_at: string };
export type AppUser = { id: string; name: string; email: string; role: "admin" | "agent" | "requester"; active: boolean };
export function isOverdue(ticket: Ticket) { return !["resolved", "closed"].includes(ticket.status) && new Date(ticket.sla_due_at).getTime() < Date.now(); }
