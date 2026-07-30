import { z } from "zod";

import type { Role } from "@/lib/auth/current-user";

export const priorities = ["low", "medium", "high"] as const;
export const statuses = ["open", "in_progress", "resolved", "closed"] as const;

export const createTicketSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required"),
  body: z.string().default(""),
  priority: z.enum(priorities),
});

export const updateTicketSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").optional(),
  body: z.string().optional(),
  priority: z.enum(priorities).optional(),
  assigneeId: z.string().nullable().optional(),
  slaDueAt: z.string().datetime().optional(),
}).refine((value) => Object.keys(value).length > 0, "No changes provided");

export const transitionSchema = z.object({ to: z.enum(statuses) });
export const noteSchema = z.object({ content: z.string().trim().min(1, "Note is required") });
export const replySchema = z.object({ content: z.string().trim().min(1, "Reply is required") });
export const cannedResponseSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  body: z.string().trim().min(1, "Body is required"),
});

export type TicketStatus = (typeof statuses)[number];
export type Ticket = {
  id: string;
  subject: string;
  body: string;
  priority: (typeof priorities)[number];
  status: TicketStatus;
  creator_id: string;
  creator_name: string;
  creator_email: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  created_at: string;
  sla_due_at: string;
};

export function isOverdue(ticket: Pick<Ticket, "sla_due_at" | "status">) {
  return !["resolved", "closed"].includes(ticket.status) && new Date(ticket.sla_due_at).getTime() < Date.now();
}

export type TicketMessage = {
  id: string;
  content: string;
  created_at: string;
  author_id: string;
  author_name: string;
  author_email: string;
};
export type TicketNote = TicketMessage;
export type TicketReply = TicketMessage;

export type DeskheroUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
};

export type CannedResponse = { id: string; title: string; body: string; created_at: string };
export type AuditEvent = {
  id: string;
  event_type: "role_change" | "activation_change" | "status_transition";
  actor_email: string;
  target: string;
  detail: string;
  created_at: string;
};
