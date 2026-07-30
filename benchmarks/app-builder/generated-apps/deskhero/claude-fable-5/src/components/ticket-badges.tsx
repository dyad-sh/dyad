import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Priority, Status } from "@/lib/tickets";

const priorityStyles: Record<Priority, string> = {
  low: "bg-slate-100 text-slate-700 hover:bg-slate-100",
  medium: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  high: "bg-red-100 text-red-700 hover:bg-red-100",
};

const statusStyles: Record<Status, string> = {
  open: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100",
  in_progress: "bg-blue-100 text-blue-700 hover:bg-blue-100",
  resolved: "bg-violet-100 text-violet-700 hover:bg-violet-100",
  closed: "bg-slate-200 text-slate-600 hover:bg-slate-200",
};

const statusLabels: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export function PriorityBadge({
  priority,
  ...props
}: { priority: Priority } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Badge
      variant="secondary"
      className={cn("capitalize", priorityStyles[priority])}
      {...props}
    >
      {priority}
    </Badge>
  );
}

export function StatusBadge({
  status,
  ...props
}: { status: Status } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Badge variant="secondary" className={statusStyles[status]} {...props}>
      {statusLabels[status]}
    </Badge>
  );
}

export function OverdueBadge() {
  return (
    <Badge
      data-testid="overdue-badge"
      className="bg-red-600 text-white hover:bg-red-600"
    >
      Overdue
    </Badge>
  );
}
