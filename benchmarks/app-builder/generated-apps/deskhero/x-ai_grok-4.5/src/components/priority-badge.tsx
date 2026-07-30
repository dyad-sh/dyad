import type { TicketPriority, TicketStatus } from "@/lib/tickets";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const priorityStyles: Record<TicketPriority, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50",
  medium: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50",
  high: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-50",
};

const statusStyles: Record<TicketStatus, string> = {
  open: "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-50",
  in_progress: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-50",
  resolved: "border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-50",
  closed: "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-100",
};

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <Badge variant="outline" className={cn("capitalize", priorityStyles[priority])}>
      {priority}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn("capitalize", statusStyles[status])}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}
