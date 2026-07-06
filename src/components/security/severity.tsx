import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SecurityFinding } from "@/ipc/types/security";

export type SecurityLevel = SecurityFinding["level"];

export const getSeverityColor = (level: SecurityLevel) => {
  switch (level) {
    case "critical":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800";
    case "high":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200 dark:border-orange-800";
    case "medium":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800";
    case "low":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300 border-gray-200 dark:border-gray-800";
  }
};

export const getSeverityIcon = (level: SecurityLevel) => {
  switch (level) {
    case "critical":
      return <AlertTriangle className="h-4 w-4" />;
    case "high":
      return <AlertCircle className="h-4 w-4" />;
    case "medium":
      return <AlertCircle className="h-4 w-4" />;
    case "low":
      return <Info className="h-4 w-4" />;
  }
};

export function SeverityBadge({ level }: { level: SecurityLevel }) {
  return (
    <Badge
      variant="outline"
      className={`${getSeverityColor(level)} uppercase text-xs font-semibold flex items-center gap-1 w-fit`}
    >
      <span className="flex-shrink-0">{getSeverityIcon(level)}</span>
      <span>{level}</span>
    </Badge>
  );
}
