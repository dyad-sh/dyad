import type { Priority } from "@/lib/tickets";
import type { Status } from "@/lib/workflow";

/** Hours until the SLA is due, by priority. */
export const SLA_HOURS: Record<Priority, number> = {
  high: 4,
  medium: 24,
  low: 72,
};

export function slaDueFrom(createdAt: Date, priority: Priority): Date {
  return new Date(createdAt.getTime() + SLA_HOURS[priority] * 60 * 60 * 1000);
}

/**
 * A ticket is overdue when its due time has passed and it is neither resolved
 * nor closed.
 */
export function isOverdue(ticket: {
  sla_due_at: string | null;
  status: Status;
}): boolean {
  if (!ticket.sla_due_at) return false;
  if (ticket.status === "resolved" || ticket.status === "closed") return false;
  return new Date(ticket.sla_due_at).getTime() < Date.now();
}

/** Formats a timestamp for a `datetime-local` input. */
export function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
