import { Badge } from "@/components/ui/badge";

export function OverdueBadge() {
  return (
    <Badge
      data-testid="overdue-badge"
      variant="outline"
      className="border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-50"
    >
      Overdue
    </Badge>
  );
}
