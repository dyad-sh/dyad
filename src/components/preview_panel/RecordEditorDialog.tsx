import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { TableColumn } from "@/ipc/types/supabase";

interface RecordEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: TableColumn[];
  row: Record<string, unknown> | null; // null for insert, row data for edit
  onSave: (data: Record<string, unknown>) => Promise<void>;
  isLoading: boolean;
  mode: "insert" | "edit";
  tableName: string;
}

export function RecordEditorDialog({
  open,
  onOpenChange,
  columns,
  row,
  onSave,
  isLoading,
  mode,
  tableName,
}: RecordEditorDialogProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  // Initialize form data when dialog opens or row changes
  useEffect(() => {
    if (open) {
      if (mode === "edit" && row) {
        setFormData({ ...row });
      } else {
        // Initialize with empty/default values for insert
        const initial: Record<string, unknown> = {};
        for (const col of columns) {
          if (col.defaultValue !== null) {
            // Skip columns with defaults - let DB handle them
            initial[col.name] = "";
          } else if (col.nullable) {
            initial[col.name] = null;
          } else {
            initial[col.name] = "";
          }
        }
        setFormData(initial);
      }
    }
  }, [open, row, columns, mode]);

  const handleFieldChange = (columnName: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [columnName]: value }));
  };

  const handleSubmit = async () => {
    // Filter out empty strings for nullable columns, convert to null
    const cleanedData: Record<string, unknown> = {};
    for (const col of columns) {
      const value = formData[col.name];
      if (value === "" && col.nullable) {
        cleanedData[col.name] = null;
      } else if (value !== undefined) {
        cleanedData[col.name] = value;
      }
    }
    await onSave(cleanedData);
  };

  const renderField = (column: TableColumn) => {
    const value = formData[column.name];
    const isPk = column.isPrimaryKey;

    // For boolean types
    if (column.type === "boolean") {
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={column.name}
            checked={value === true}
            onCheckedChange={(checked) =>
              handleFieldChange(column.name, checked)
            }
            disabled={isLoading || (mode === "edit" && isPk)}
          />
          <Label htmlFor={column.name} className="text-sm font-normal">
            {value === true ? "true" : value === false ? "false" : "null"}
          </Label>
        </div>
      );
    }

    // For JSON/JSONB types
    if (column.type === "json" || column.type === "jsonb") {
      return (
        <Input
          id={column.name}
          value={
            typeof value === "object" && value !== null
              ? JSON.stringify(value)
              : String(value ?? "")
          }
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              handleFieldChange(column.name, parsed);
            } catch {
              // Keep as string if not valid JSON
              handleFieldChange(column.name, e.target.value);
            }
          }}
          placeholder={column.nullable ? "null" : "{}"}
          disabled={isLoading || (mode === "edit" && isPk)}
          className="font-mono text-xs"
        />
      );
    }

    // For numeric types
    if (
      column.type.includes("int") ||
      column.type === "numeric" ||
      column.type === "decimal" ||
      column.type === "real" ||
      column.type === "double precision"
    ) {
      return (
        <Input
          id={column.name}
          type="number"
          value={value === null ? "" : String(value ?? "")}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "") {
              handleFieldChange(column.name, column.nullable ? null : "");
            } else {
              handleFieldChange(
                column.name,
                column.type.includes("int")
                  ? parseInt(val, 10)
                  : parseFloat(val),
              );
            }
          }}
          placeholder={column.nullable ? "null" : "0"}
          disabled={isLoading || (mode === "edit" && isPk)}
        />
      );
    }

    // Default: text input
    return (
      <Input
        id={column.name}
        value={value === null ? "" : String(value ?? "")}
        onChange={(e) => handleFieldChange(column.name, e.target.value)}
        placeholder={column.nullable ? "null" : ""}
        disabled={isLoading || (mode === "edit" && isPk)}
      />
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {mode === "insert" ? "Insert Row" : "Edit Row"}
          </DialogTitle>
          <DialogDescription>
            {mode === "insert"
              ? `Add a new row to ${tableName}`
              : `Edit row in ${tableName}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {columns.map((column) => (
            <div key={column.name} className="grid gap-2">
              <Label htmlFor={column.name} className="text-sm">
                <span className="font-mono">{column.name}</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  {column.type}
                  {column.nullable && " (nullable)"}
                  {column.isPrimaryKey && " (PK)"}
                </span>
              </Label>
              {renderField(column)}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {mode === "insert" ? "Insert" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
