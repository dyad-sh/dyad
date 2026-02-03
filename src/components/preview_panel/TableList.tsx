import { Table2, Loader2 } from "lucide-react";
import { useSupabaseTables } from "@/hooks/useSupabaseTables";

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
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
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
      <div className="flex-1 overflow-y-auto">
        {tables.map((table) => (
          <button
            key={table}
            onClick={() => onSelectTable(table)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors ${
              selectedTable === table ? "bg-muted font-medium" : ""
            }`}
          >
            <Table2 size={14} className="text-muted-foreground flex-shrink-0" />
            <span className="truncate">{table}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
