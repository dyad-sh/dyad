import { ChevronLeft, ChevronRight } from "lucide-react";

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
        <span className="text-muted-foreground">Rows per page:</span>
        <select
          value={limit}
          onChange={(e) => handleLimitChange(Number(e.target.value))}
          disabled={isLoading}
          className="bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-muted-foreground">
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
          <button
            onClick={handlePrev}
            disabled={!hasPrev || isLoading}
            className="p-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Previous page"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={handleNext}
            disabled={!hasNext || isLoading}
            className="p-1 rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Next page"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
