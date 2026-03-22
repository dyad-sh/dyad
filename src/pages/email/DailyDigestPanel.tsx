/**
 * Daily Digest Panel
 *
 * Displays an AI-generated summary of the day's unread emails with
 * action items and statistics.
 */

import { Newspaper, RefreshCw, AlertCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDailyDigest, useEmailStats } from "@/hooks/useEmail";

interface DailyDigestPanelProps {
  accountId: string;
}

export function DailyDigestPanel({ accountId }: DailyDigestPanelProps) {
  const digest = useDailyDigest();
  const stats = useEmailStats(accountId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-emerald-500" />
          <span className="text-sm font-semibold">Daily Digest</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => digest.refetch()}
          disabled={digest.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${digest.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {/* Stats bar */}
        {stats.data && (
          <div className="grid grid-cols-2 gap-2 border-b border-border/40 p-4">
            <StatCard label="Unread" value={stats.data.unread} color="text-blue-500" />
            <StatCard label="Total" value={stats.data.total} color="text-muted-foreground" />
          </div>
        )}

        {!digest.data && !digest.isFetching && (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            <Newspaper className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Your daily digest summarizes today's emails.
            </p>
          </div>
        )}

        {digest.isFetching && !digest.data && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <RefreshCw className="h-6 w-6 animate-spin text-emerald-500" />
            <p className="text-sm text-muted-foreground">Analyzing your emails...</p>
          </div>
        )}

        {digest.data && (
          <div className="space-y-4 p-4">
            {/* Summary */}
            <div>
              <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Summary
              </h4>
              <p className="text-sm leading-relaxed">{digest.data.summary}</p>
            </div>

            {/* Urgent */}
            {digest.data.urgent.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Urgent ({digest.data.urgent.length})
                </h4>
                <ul className="space-y-1.5">
                  {digest.data.urgent.map((msg) => (
                    <li key={msg.id} className="flex items-start gap-2 text-sm">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                      <span className="line-clamp-1">{msg.subject}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Action Required */}
            {digest.data.actionRequired.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Action Required ({digest.data.actionRequired.length})
                </h4>
                <ul className="space-y-1.5">
                  {digest.data.actionRequired.map((msg) => (
                    <li key={msg.id} className="flex items-start gap-2 text-sm">
                      <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span className="line-clamp-1">{msg.subject}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Top Action Items */}
            {digest.data.topActionItems.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Top Action Items
                </h4>
                <ul className="space-y-1.5">
                  {digest.data.topActionItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[9px] font-bold text-emerald-500">
                        {i + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-md border border-border/30 p-2 text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
