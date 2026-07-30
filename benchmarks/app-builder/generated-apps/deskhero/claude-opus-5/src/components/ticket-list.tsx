import Link from "next/link";
import { OverdueBadge } from "@/components/overdue-badge";
import {
  priorityClasses,
  statusClasses,
  statusLabels,
  type Ticket,
} from "@/lib/tickets";
import { isOverdue } from "@/lib/sla";

type Props = {
  tickets: Ticket[];
  testId?: string;
  emptyMessage?: string;
  showAssignee?: boolean;
};

export function TicketList({
  tickets,
  testId,
  emptyMessage = "Nothing here yet.",
  showAssignee = false,
}: Props) {
  if (tickets.length === 0) {
    return (
      <div
        data-testid={testId}
        className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500"
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul
      data-testid={testId}
      className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      {tickets.map((ticket) => (
        <li key={ticket.id} data-testid="ticket-row">
          <Link
            href={`/tickets/${ticket.id}`}
            className="flex items-center justify-between gap-4 px-4 py-4 transition hover:bg-slate-50"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">
                {ticket.subject}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {new Date(ticket.created_at).toLocaleString()}
                {showAssignee && (
                  <>
                    {" · "}
                    {ticket.assignee_id
                      ? `Assigned to ${ticket.assignee_name || ticket.assignee_email}`
                      : "Unassigned"}
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${priorityClasses[ticket.priority]}`}
              >
                {ticket.priority}
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClasses[ticket.status]}`}
              >
                {statusLabels[ticket.status]}
              </span>
              {isOverdue(ticket) && <OverdueBadge />}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
