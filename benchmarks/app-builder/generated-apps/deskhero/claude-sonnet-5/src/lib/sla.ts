import type { TicketPriority } from "@/types/ticket";

const SLA_HOURS_BY_PRIORITY: Record<TicketPriority, number> = {
  high: 4,
  medium: 24,
  low: 72,
};

export function computeSlaDueAt(priority: TicketPriority, from = new Date()): Date {
  const hours = SLA_HOURS_BY_PRIORITY[priority];
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}
