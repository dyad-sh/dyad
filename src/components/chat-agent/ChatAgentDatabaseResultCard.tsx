import { useMemo, useState } from "react";
import { ChevronDown, Database, Rows3 } from "lucide-react";

import type { ChatAgentToolPresentation } from "@/ipc/types/chat_agent";

/**
 * Query results as a table.
 *
 * A model retelling forty rows in prose loses the alignment that makes a table
 * readable, and occasionally loses a row. So the rows arrive as data and are
 * laid out here, and the model's commentary appears below as commentary rather
 * than as the only record of what was returned.
 *
 * Two rules shape the layout. Every column and every returned row is present:
 * nothing is dropped to make it fit, because a table that quietly omits a
 * column is worse than one that scrolls. And the table scrolls inside its own
 * box, so a wide result never widens the conversation around it.
 */

type Presentation = Extract<
  ChatAgentToolPresentation,
  { kind: "database-result" }
>;

/** Beyond this, the table starts collapsed so one query cannot fill the view. */
const COLLAPSE_ABOVE_ROWS = 12;

/**
 * Cells that are numeric are right-aligned, as in every spreadsheet.
 *
 * Judged per column rather than per cell, so one stray non-numeric value does
 * not make a column of figures ragged.
 */
function isNumericColumn(rows: string[][], index: number): boolean {
  const values = rows
    .map((row) => row[index] ?? "")
    .filter((value) => value !== "" && value !== "—");
  if (values.length === 0) return false;
  return values.every((value) => /^-?[\d,]+(\.\d+)?$/.test(value.trim()));
}

export function ChatAgentDatabaseResultCard({
  presentation,
}: {
  presentation: Presentation;
}) {
  const { sourceName, table, columns, rows, totalRows, executionMs } =
    presentation;

  const [expanded, setExpanded] = useState(rows.length <= COLLAPSE_ABOVE_ROWS);
  const numericColumns = useMemo(
    () => columns.map((_, index) => isNumericColumn(rows, index)),
    [columns, rows],
  );

  const visibleRows = expanded ? rows : rows.slice(0, COLLAPSE_ABOVE_ROWS);
  const withheld = rows.length - visibleRows.length;

  if (columns.length === 0 || rows.length === 0) {
    return (
      <section className="chat-agent-db-card">
        <header className="chat-agent-db-head">
          <Database className="size-4 text-cyan-300" />
          <span className="chat-agent-db-title">{table}</span>
          <span className="chat-agent-db-source">{sourceName}</span>
        </header>
        <p className="chat-agent-db-empty">No rows matched this query.</p>
      </section>
    );
  }

  return (
    <section className="chat-agent-db-card" data-testid="chat-agent-db-result">
      <header className="chat-agent-db-head">
        <Database className="size-4 shrink-0 text-cyan-300" />
        <span className="chat-agent-db-title">{table}</span>
        <span className="chat-agent-db-source">{sourceName}</span>
        <span className="chat-agent-db-meta">
          <Rows3 className="size-3" />
          {/* States what was returned against what matched, so a truncated
              result is never mistaken for the whole answer. */}
          {totalRows !== null && totalRows > rows.length
            ? `${rows.length} of ${totalRows.toLocaleString()} rows`
            : `${rows.length} ${rows.length === 1 ? "row" : "rows"}`}
          {executionMs !== undefined && ` · ${executionMs} ms`}
        </span>
      </header>

      {/* The scroll container is the table's own, so a wide result never
          widens the message around it. */}
      <div className="chat-agent-db-scroll">
        <table className="chat-agent-db-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className={
                    numericColumns[columns.indexOf(column)]
                      ? "chat-agent-db-num"
                      : undefined
                  }
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column, columnIndex) => {
                  const value = row[columnIndex] ?? "";
                  return (
                    <td
                      key={column}
                      className={
                        numericColumns[columnIndex]
                          ? "chat-agent-db-num"
                          : undefined
                      }
                      // The full value is always available on hover, even
                      // where a long cell is visually clamped.
                      title={value}
                    >
                      {value === "" ? (
                        <span className="chat-agent-db-null">—</span>
                      ) : (
                        value
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {withheld > 0 && (
        <button
          type="button"
          className="chat-agent-db-more"
          onClick={() => setExpanded(true)}
        >
          <ChevronDown className="size-3.5" />
          Show {withheld} more {withheld === 1 ? "row" : "rows"}
        </button>
      )}
    </section>
  );
}
