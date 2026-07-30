import type { TicketPriority, TicketStatus } from "@/lib/tickets";

const SLA_HOURS: Record<TicketPriority, number> = {
  high: 4,
  medium: 24,
  low: 72,
};

export function slaDueAtFrom(
  createdAt: Date | string,
  priority: TicketPriority,
): Date {
  const base =
    createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  return new Date(base + SLA_HOURS[priority] * 60 * 60 * 1000);
}

export function isTicketOverdue(options: {
  slaDueAt: string | Date | null | undefined;
  status: TicketStatus;
  now?: Date;
}): boolean {
  const { slaDueAt, status, now = new Date() } = options;
  if (!slaDueAt) return false;
  if (status === "resolved" || status === "closed") return false;
  const due = slaDueAt instanceof Date ? slaDueAt : new Date(slaDueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}

export function toDatetimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
