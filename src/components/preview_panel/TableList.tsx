import { Table2 } from "lucide-react";
import { useSupabaseTables } from "@/hooks/useSupabaseTables";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface TableListProps {
  projectId: string | null;
  organizationSlug: string | null;
  selectedTable: string | null;
  onSelectTable: (table: string) => void;
}

export function TableList({
  projectId,
  organizationSlug,
  selectedTable,
  onSelectTable,
}: TableListProps) {
  const {
    data: tables,
    isLoading,
    error,
  } = useSupabaseTables({
    projectId,
    organizationSlug,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-border">
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex-1 p-3">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-500">
        Failed to load tables: {error.message}
      </div>
    );
  }

  if (!tables || tables.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No tables found in the public schema.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-sm font-medium text-muted-foreground">
          Tables ({tables.length})
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-1">
          {tables.map((table) => (
            <Button
              key={table}
              variant={selectedTable === table ? "secondary" : "ghost"}
              onClick={() => onSelectTable(table)}
              className="justify-start font-mono text-xs h-9"
            >
              <Table2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{table}</span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
