import { Pencil, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatCellValue } from "@/lib/supabase_utils";

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey?: boolean;
}

interface ResultsTableProps {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  onRowClick?: (row: Record<string, unknown>) => void;
  onEdit?: (row: Record<string, unknown>) => void;
  onDelete?: (row: Record<string, unknown>) => void;
  showActions?: boolean;
}

export function ResultsTable({
  columns,
  rows,
  onRowClick,
  onEdit,
  onDelete,
  showActions = false,
}: ResultsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        No rows in this table
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          {showActions && (
            <TableHead className="text-xs w-[80px]">Actions</TableHead>
          )}
          {columns.map((col) => (
            <TableHead key={col.name} className="font-mono text-xs">
              {col.name}
              {col.isPrimaryKey && (
                <span className="ml-1 text-muted-foreground">(PK)</span>
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, rowIdx) => (
          <TableRow
            key={row.id ? String(row.id) : rowIdx}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={onRowClick ? "cursor-pointer" : undefined}
          >
            {showActions && (
              <TableCell className="py-1">
                <div className="flex items-center gap-1">
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(row);
                      }}
                      title="Edit row"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(row);
                      }}
                      title="Delete row"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </TableCell>
            )}
            {columns.map((col) => (
              <TableCell
                key={col.name}
                className={`font-mono text-xs whitespace-nowrap ${
                  row[col.name] === null ? "text-muted-foreground italic" : ""
                }`}
              >
                {formatCellValue(row[col.name])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface SchemaTableProps {
  columns: ColumnInfo[];
}

export function SchemaTable({ columns }: SchemaTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          <TableHead className="text-xs">Column</TableHead>
          <TableHead className="text-xs">Type</TableHead>
          <TableHead className="text-xs">Nullable</TableHead>
          <TableHead className="text-xs">Default</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {columns.map((col) => (
          <TableRow key={col.name}>
            <TableCell className="font-mono text-xs py-1">{col.name}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground py-1">
              {col.type}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground py-1">
              {col.nullable ? "Yes" : "No"}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground py-1 truncate max-w-[200px]">
              {col.defaultValue ?? "-"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
