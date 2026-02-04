import { useState } from "react";
import { Loader2, AlertCircle, Plus } from "lucide-react";
import { useSupabaseSchema, useSupabaseRows } from "@/hooks/useSupabaseTables";
import { useRowMutations } from "@/hooks/useRowMutations";
import { PaginationControls } from "./PaginationControls";
import { ResultsTable, SchemaTable } from "./ResultsTable";
import { RecordEditorDialog } from "./RecordEditorDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { showError, showSuccess } from "@/lib/toast";
import type { TableColumn } from "@/ipc/types/supabase";

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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"insert" | "edit">("insert");
  const [selectedRow, setSelectedRow] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<Record<
    string,
    unknown
  > | null>(null);

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

  const { insertRow, updateRow, deleteRow } = useRowMutations({
    projectId,
    organizationSlug,
    table,
  });

  const columns = schema ?? [];
  const rows = rowsData?.rows ?? [];
  const total = rowsData?.total ?? null;

  // Get primary key columns
  const getPrimaryKey = (
    row: Record<string, unknown>,
  ): Record<string, unknown> => {
    const pkColumns = columns.filter((col) => col.isPrimaryKey);
    if (pkColumns.length === 0) {
      // Fallback: use 'id' column if exists, otherwise use all columns
      if ("id" in row) {
        return { id: row.id };
      }
      return row;
    }
    const pk: Record<string, unknown> = {};
    for (const col of pkColumns) {
      pk[col.name] = row[col.name];
    }
    return pk;
  };

  const handleInsertClick = () => {
    setSelectedRow(null);
    setEditorMode("insert");
    setEditorOpen(true);
  };

  const handleEditClick = (row: Record<string, unknown>) => {
    setSelectedRow(row);
    setEditorMode("edit");
    setEditorOpen(true);
  };

  const handleDeleteClick = (row: Record<string, unknown>) => {
    setRowToDelete(row);
    setDeleteDialogOpen(true);
  };

  const handleSave = async (data: Record<string, unknown>) => {
    try {
      if (editorMode === "insert") {
        await insertRow.mutateAsync(data);
        showSuccess("Row inserted successfully");
      } else {
        const primaryKey = getPrimaryKey(selectedRow!);
        // Only send changed fields
        const changedData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          if (data[key] !== selectedRow![key]) {
            changedData[key] = data[key];
          }
        }
        if (Object.keys(changedData).length > 0) {
          await updateRow.mutateAsync({ primaryKey, data: changedData });
          showSuccess("Row updated successfully");
        }
      }
      setEditorOpen(false);
    } catch (error) {
      showError(error);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!rowToDelete) return;
    try {
      const primaryKey = getPrimaryKey(rowToDelete);
      await deleteRow.mutateAsync(primaryKey);
      showSuccess("Row deleted successfully");
      setDeleteDialogOpen(false);
      setRowToDelete(null);
    } catch (error) {
      showError(error);
    }
  };

  if (!table) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a table to view its data
      </div>
    );
  }

  if (schemaLoading || rowsLoading) {
    return (
      <div className="flex flex-col h-full">
        {/* Schema skeleton */}
        <div className="border-b border-border">
          <div className="px-4 py-2 bg-muted/30">
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="p-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        {/* Rows skeleton */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 py-2 bg-muted/30 border-b border-border">
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="p-3 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (schemaError) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load schema</AlertTitle>
          <AlertDescription>{schemaError.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (rowsError) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load rows</AlertTitle>
          <AlertDescription>{rowsError.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

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
          <SchemaTable columns={columns} />
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
          <div className="flex items-center gap-2">
            {rowsFetching && !rowsLoading && (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleInsertClick}
              className="h-7 text-xs"
            >
              <Plus className="h-3 w-3 mr-1" />
              Insert
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <ResultsTable
            columns={columns}
            rows={rows}
            showActions
            onEdit={handleEditClick}
            onDelete={handleDeleteClick}
          />
        </div>

        <PaginationControls
          total={total}
          limit={limit}
          offset={offset}
          onLimitChange={onLimitChange}
          onOffsetChange={onOffsetChange}
          isLoading={rowsFetching}
        />
      </div>

      {/* Edit/Insert Dialog */}
      <RecordEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        columns={columns as TableColumn[]}
        row={selectedRow}
        onSave={handleSave}
        isLoading={insertRow.isPending || updateRow.isPending}
        mode={editorMode}
        tableName={table}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Row</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this row? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteRow.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
