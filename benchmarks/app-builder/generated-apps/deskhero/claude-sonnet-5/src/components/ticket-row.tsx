import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Ticket } from "@/types/ticket";

const priorityVariant: Record<string, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

export function TicketRow({
  ticket,
  subtitle,
}: {
  ticket: Ticket;
  subtitle?: string;
}) {
  return (
    <Link
      href={`/tickets/${ticket.id}`}
      data-testid="ticket-row"
      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow"
    >
      <div>
        <p className="font-medium text-slate-900">{ticket.subject}</p>
        <p className="mt-1 text-xs text-slate-500">
          {new Date(ticket.created_at).toLocaleString()}
          {subtitle ? ` \u00b7 ${subtitle}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {ticket.overdue && (
          <Badge data-testid="overdue-badge" className="bg-red-600 text-white">
            Overdue
          </Badge>
        )}
        <Badge className={priorityVariant[ticket.priority]}>
          {ticket.priority}
        </Badge>
        <Badge variant="secondary">{ticket.status}</Badge>
      </div>
    </Link>
  );
}
