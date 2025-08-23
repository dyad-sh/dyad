import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle, XCircle, PlayCircle } from "lucide-react";

interface McpStatusBadgeProps {
  status: 'checking' | 'available' | 'unavailable';
  className?: string;
}

export function McpStatusBadge({ status, className }: McpStatusBadgeProps) {
  switch (status) {
    case 'checking':
      return (
        <Badge
          variant="secondary"
          className={`flex items-center gap-1 ${className}`}
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking
        </Badge>
      );
    case 'available':
      return (
        <Badge
          variant="default"
          className={`flex items-center gap-1 bg-green-500 hover:bg-green-600 ${className}`}
        >
          <CheckCircle className="h-3 w-3" />
          Available
        </Badge>
      );
    case 'unavailable':
      return (
        <Badge
          variant="destructive"
          className={`flex items-center gap-1 ${className}`}
        >
          <XCircle className="h-3 w-3" />
          Unavailable
        </Badge>
      );
    default:
      return (
        <Badge
          variant="outline"
          className={`flex items-center gap-1 ${className}`}
        >
          <PlayCircle className="h-3 w-3" />
          Unknown
        </Badge>
      );
  }
}
