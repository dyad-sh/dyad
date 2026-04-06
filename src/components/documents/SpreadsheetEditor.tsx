import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

interface SpreadsheetEditorProps {
  initialRows: string[][];
  onChange?: (rows: string[][]) => void;
  className?: string;
}

const MIN_ROWS = 20;
const MIN_COLS = 10;

const COL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function padRows(rows: string[][], minRows: number, minCols: number): string[][] {
  const padded = rows.map((row) => {
    const copy = [...row];
    while (copy.length < minCols) copy.push("");
    return copy;
  });
  while (padded.length < minRows) {
    padded.push(Array(minCols).fill(""));
  }
  return padded;
}

export function SpreadsheetEditor({ initialRows, onChange, className }: SpreadsheetEditorProps) {
  const [rows, setRows] = useState<string[][]>(() => padRows(initialRows, MIN_ROWS, MIN_COLS));
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const numCols = rows[0]?.length ?? MIN_COLS;

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitEdit = useCallback(
    (r: number, c: number, value: string) => {
      setRows((prev) => {
        const next = prev.map((row) => [...row]);
        next[r][c] = value;
        onChange?.(next);
        return next;
      });
      setEditing(null);
    },
    [onChange]
  );

  const startEdit = useCallback((r: number, c: number) => {
    setSelected({ r, c });
    setEditing({ r, c });
    setEditValue(rows[r][c]);
  }, [rows]);

  const addRow = useCallback(() => {
    setRows((prev) => {
      const next = [...prev, Array(numCols).fill("")];
      onChange?.(next);
      return next;
    });
  }, [numCols, onChange]);

  const addCol = useCallback(() => {
    setRows((prev) => {
      const next = prev.map((row) => [...row, ""]);
      onChange?.(next);
      return next;
    });
  }, [onChange]);

  const deleteRow = useCallback(
    (r: number) => {
      setRows((prev) => {
        const next = prev.filter((_, i) => i !== r);
        onChange?.(next);
        return next;
      });
    },
    [onChange]
  );

  return (
    <div className={cn("flex flex-col h-full overflow-auto", className)}>
      <div className="flex gap-2 p-2 border-b bg-muted/30 shrink-0">
        <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5">
          <Plus className="size-3" /> Row
        </Button>
        <Button variant="outline" size="sm" onClick={addCol} className="gap-1.5">
          <Plus className="size-3" /> Column
        </Button>
        {selected !== null && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => deleteRow(selected.r)}
            className="ml-auto gap-1.5 text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3" /> Delete row
          </Button>
        )}
      </div>

      <div className="overflow-auto flex-1">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              {/* Row number header */}
              <th className="w-10 min-w-[2.5rem] h-7 bg-muted/60 border border-border text-center text-xs text-muted-foreground font-medium sticky top-0 left-0 z-20" />
              {Array.from({ length: numCols }, (_, c) => (
                <th
                  key={c}
                  className="min-w-[7rem] h-7 bg-muted/60 border border-border text-center text-xs text-muted-foreground font-medium sticky top-0 z-10 px-1"
                >
                  {COL_LETTERS[c] ?? String(c + 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {/* Row number */}
                <td className="w-10 min-w-[2.5rem] h-7 bg-muted/40 border border-border text-center text-xs text-muted-foreground sticky left-0 z-10 select-none">
                  {r + 1}
                </td>
                {row.map((cell, c) => {
                  const isEditing = editing?.r === r && editing?.c === c;
                  const isSelected = selected?.r === r && selected?.c === c;
                  return (
                    <td
                      key={c}
                      className={cn(
                        "h-7 border border-border relative p-0",
                        isSelected && !isEditing && "outline outline-2 outline-primary outline-offset-[-1px]"
                      )}
                      onClick={() => setSelected({ r, c })}
                      onDoubleClick={() => startEdit(r, c)}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => commitEdit(r, c, editValue)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit(r, c, editValue);
                            if (e.key === "Escape") setEditing(null);
                            if (e.key === "Tab") {
                              e.preventDefault();
                              commitEdit(r, c, editValue);
                              const nextC = c + 1 < numCols ? c + 1 : 0;
                              const nextR = c + 1 < numCols ? r : r + 1 < rows.length ? r + 1 : r;
                              startEdit(nextR, nextC);
                            }
                          }}
                          className="absolute inset-0 w-full h-full px-1.5 bg-background border-0 outline-none text-sm z-10"
                        />
                      ) : (
                        <span className="block w-full h-full px-1.5 leading-7 truncate">
                          {cell}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
