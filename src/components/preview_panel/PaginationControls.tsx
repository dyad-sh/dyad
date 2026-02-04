import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PaginationControlsProps {
  total: number | null;
  limit: number;
  offset: number;
  onLimitChange: (limit: number) => void;
  onOffsetChange: (offset: number) => void;
  isLoading?: boolean;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function PaginationControls({
  total,
  limit,
  offset,
  onLimitChange,
  onOffsetChange,
  isLoading = false,
}: PaginationControlsProps) {
  // For empty tables (total=0), start should be 0 to avoid showing "1-0 of 0"
  const isEmpty = total === 0;
  const start = isEmpty ? 0 : offset + 1;
  const end = Math.min(offset + limit, total ?? offset + limit);
  const hasPrev = offset > 0;
  const hasNext = total !== null ? offset + limit < total : false;

  const handlePrev = () => {
    onOffsetChange(Math.max(0, offset - limit));
  };

  const handleNext = () => {
    onOffsetChange(offset + limit);
  };

  const handleLimitChange = (newLimit: number) => {
    // Reset to first page when changing page size
    onOffsetChange(0);
    onLimitChange(newLimit);
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-border text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">Rows per page:</span>
        <Select
          value={String(limit)}
          onValueChange={(value) => handleLimitChange(Number(value))}
          disabled={isLoading}
        >
          <SelectTrigger size="sm" className="w-[70px] h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-muted-foreground text-xs">
          {total !== null ? (
            <>
              Showing {start}-{end} of {total} rows
            </>
          ) : (
            <>
              Showing {start}-{end} rows
            </>
          )}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePrev}
            disabled={!hasPrev || isLoading}
            className="h-7 w-7"
            title="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNext}
            disabled={!hasNext || isLoading}
            className="h-7 w-7"
            title="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
