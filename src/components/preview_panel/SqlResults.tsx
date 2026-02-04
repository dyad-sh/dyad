import { AlertCircle, CheckCircle2 } from "lucide-react";
import { ResultsTable, type ColumnInfo } from "./ResultsTable";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import type { ExecuteSqlResult } from "@/ipc/types/supabase";

interface SqlResultsProps {
  result: ExecuteSqlResult | null;
  isLoading: boolean;
}

export function SqlResults({ result, isLoading }: SqlResultsProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Executing query...
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Run a query to see results
      </div>
    );
  }

  if (result.error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Query Error</AlertTitle>
          <AlertDescription className="font-mono text-xs whitespace-pre-wrap">
            {result.error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (result.rows.length === 0) {
    return (
      <div className="p-4">
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Query executed successfully</AlertTitle>
          <AlertDescription>
            {result.rowCount === 0
              ? "No rows returned"
              : `${result.rowCount} row(s) affected`}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Convert columns to ColumnInfo format for ResultsTable
  const columns: ColumnInfo[] = result.columns.map((col) => ({
    name: col,
    type: "unknown",
    nullable: true,
    defaultValue: null,
  }));

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          Results
        </span>
        <span className="text-xs text-muted-foreground">
          {result.rowCount} row{result.rowCount !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        <ResultsTable columns={columns} rows={result.rows} />
      </div>
    </div>
  );
}
