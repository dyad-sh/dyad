import { Loader2 } from "lucide-react";
import { useSupabaseSchema, useSupabaseRows } from "@/hooks/useSupabaseTables";
import { PaginationControls } from "./PaginationControls";
import { formatCellValue } from "@/lib/supabase_utils";

interface TableDetailsProps {
  projectId: string | null;
  organizationSlug: string | null;
  table: string | null;
  limit: number;
  offset: number;
  onLimitChange: (limit: number) => void;
  onOffsetChange: (offset: number) => void;
}

export function TableDetails({
  projectId,
  organizationSlug,
  table,
  limit,
  offset,
  onLimitChange,
  onOffsetChange,
}: TableDetailsProps) {
  const {
    data: schema,
    isLoading: schemaLoading,
    error: schemaError,
  } = useSupabaseSchema({
    projectId,
    organizationSlug,
    table,
  });

  const {
    data: rowsData,
    isLoading: rowsLoading,
    isFetching: rowsFetching,
    error: rowsError,
  } = useSupabaseRows({
    projectId,
    organizationSlug,
    table,
    limit,
    offset,
  });

  if (!table) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a table to view its data
      </div>
    );
  }

  if (schemaLoading || rowsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (schemaError) {
    return (
      <div className="p-4 text-sm text-red-500">
        Failed to load schema: {schemaError.message}
      </div>
    );
  }

  if (rowsError) {
    return (
      <div className="p-4 text-sm text-red-500">
        Failed to load rows: {rowsError.message}
      </div>
    );
  }

  const columns = schema ?? [];
  const rows = rowsData?.rows ?? [];
  const total = rowsData?.total ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Schema section */}
      <div className="border-b border-border">
        <div className="px-4 py-2 bg-muted/30">
          <h3 className="text-sm font-medium">
            Schema: <span className="font-mono">{table}</span>
          </h3>
        </div>
        <div className="max-h-32 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">
                  Column
                </th>
                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">
                  Type
                </th>
                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">
                  Nullable
                </th>
                <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">
                  Default
                </th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col) => (
                <tr key={col.name} className="border-t border-border/50">
                  <td className="px-3 py-1 font-mono">{col.name}</td>
                  <td className="px-3 py-1 text-muted-foreground font-mono">
                    {col.type}
                  </td>
                  <td className="px-3 py-1 text-muted-foreground">
                    {col.nullable ? "Yes" : "No"}
                  </td>
                  <td className="px-3 py-1 text-muted-foreground font-mono truncate max-w-[200px]">
                    {col.defaultValue ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Rows section */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-medium">
            Rows{" "}
            {total !== null && (
              <span className="text-muted-foreground">({total})</span>
            )}
          </h3>
          {rowsFetching && !rowsLoading && (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {rows.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            No rows in this table
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.name}
                      className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                    >
                      {col.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIdx) => (
                  <tr
                    key={row.id ? String(row.id) : rowIdx}
                    className="border-t border-border/50 hover:bg-muted/30"
                  >
                    {columns.map((col) => (
                      <td
                        key={col.name}
                        className={`px-3 py-1.5 font-mono whitespace-nowrap ${
                          row[col.name] === null
                            ? "text-muted-foreground italic"
                            : ""
                        }`}
                      >
                        {formatCellValue(row[col.name])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <PaginationControls
          total={total}
          limit={limit}
          offset={offset}
          onLimitChange={onLimitChange}
          onOffsetChange={onOffsetChange}
          isLoading={rowsFetching}
        />
      </div>
    </div>
  );
}
