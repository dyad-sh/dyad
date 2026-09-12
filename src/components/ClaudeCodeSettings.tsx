import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useClaudeCodeStatus,
  useClaudeCodeUsageSummary,
} from "@/hooks/useClaudeCodeStatus";
import { useSettings } from "@/hooks/useSettings";
import { formatUsd } from "@/shared/claude_code_pricing";
import { CLAUDE_CODE_CHARGE_DISCLOSURE } from "./ClaudeCodeChargeDialog";
import { cn } from "@/lib/utils";

const statusPill = "rounded-full px-2 py-0.5 text-[11px] font-medium";

export function ClaudeCodeStatusSummary({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { status, isLoading, refresh, isRefreshing } = useClaudeCodeStatus();
  if (isLoading || !status) {
    return (
      <p className="text-xs text-muted-foreground">
        Checking Claude Code status...
      </p>
    );
  }
  const pill = status.ready ? (
    <span
      className={cn(
        statusPill,
        "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      )}
    >
      Connected
    </span>
  ) : status.installed ? (
    <span
      className={cn(
        statusPill,
        "bg-amber-500/15 text-amber-700 dark:text-amber-300",
      )}
    >
      Setup needed
    </span>
  ) : (
    <span className={cn(statusPill, "bg-muted text-muted-foreground")}>
      Not installed
    </span>
  );
  return (
    <div className="space-y-1.5" data-testid="claude-code-status-summary">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Claude Code</span>
        {pill}
        {status.version && (
          <span className="text-xs text-muted-foreground">
            v{status.version}
            {!status.versionSupported &&
              ` (requires ${status.minimumVersion}+)`}
          </span>
        )}
        {status.auth.state === "authenticated" && (
          <span className="text-xs text-muted-foreground">
            Signed in
            {status.auth.subscriptionType
              ? ` · ${status.auth.subscriptionType} plan`
              : ""}
            {status.auth.email ? ` · ${status.auth.email}` : ""}
          </span>
        )}
      </div>
      {status.setupGuidance && (
        <p className="text-xs text-muted-foreground">{status.setupGuidance}</p>
      )}
      {!compact && status.executablePath && (
        <p className="text-xs text-muted-foreground break-all">
          CLI: {status.executablePath}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        disabled={isRefreshing}
        onClick={() => void refresh()}
      >
        {isRefreshing ? "Checking..." : "Re-check status"}
      </Button>
    </div>
  );
}

export function ClaudeCodeUsagePanel() {
  const { summary, isLoading, retryReports, isRetrying } =
    useClaudeCodeUsageSummary({ limit: 20 });
  if (isLoading || !summary) {
    return <p className="text-xs text-muted-foreground">Loading usage...</p>;
  }
  const { totals } = summary;
  return (
    <div className="space-y-2" data-testid="claude-code-usage-panel">
      <p className="text-xs text-muted-foreground">{summary.pricingRule}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <div className="text-muted-foreground">Billable tokens</div>
          <div className="font-medium">
            {totals.billableTokens.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">API list price</div>
          <div className="font-medium">{formatUsd(totals.listPriceUsd)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Estimated Dyad charge</div>
          <div className="font-medium">
            {formatUsd(totals.estimatedDyadChargeUsd)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Confirmed by Dyad</div>
          <div className="font-medium">
            {formatUsd(totals.confirmedDyadChargeUsd)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{totals.reportedCount} reported</span>
        <span>· {totals.pendingCount} pending</span>
        <span>· {totals.rejectedCount} not billed</span>
        {totals.pendingCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            disabled={isRetrying}
            onClick={() => void retryReports()}
          >
            {isRetrying ? "Retrying..." : "Retry pending reports"}
          </Button>
        )}
      </div>
      {summary.events.length > 0 && (
        <ul className="divide-y rounded-md border text-xs">
          {summary.events.map((event) => (
            <li key={event.id} className="space-y-0.5 px-2 py-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {event.models.map((model) => model.model).join(", ") ||
                    "No usage reported"}
                </span>
                <span
                  className={cn(
                    statusPill,
                    event.status === "reported"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : event.status === "pending"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                        : "bg-destructive/10 text-destructive",
                  )}
                >
                  {event.status}
                </span>
                <span className="text-muted-foreground">
                  {event.turnStatus} · {event.billableTokens.toLocaleString()}{" "}
                  tokens · est. {formatUsd(event.estimatedDyadChargeUsd)}
                  {event.chargedUsd !== null &&
                    ` · charged ${formatUsd(event.chargedUsd)}`}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </div>
              {event.models.some(
                (model) => model.pricingBasis === "unknown-model-flat-rate",
              ) && (
                <div className="text-muted-foreground">
                  Flat unknown-model rate applied to:{" "}
                  {event.models
                    .filter((m) => m.pricingBasis === "unknown-model-flat-rate")
                    .map((m) => m.model)
                    .join(", ")}
                </div>
              )}
              {event.lastError && (
                <div className="text-destructive">{event.lastError}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ClaudeCodeSettings() {
  const { settings, updateSettings } = useSettings();
  const { refresh } = useClaudeCodeStatus();
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const storedPath = settings?.claudeCodeExecutablePath ?? "";
  const value = pathDraft ?? storedPath;

  const savePath = async () => {
    const trimmed = value.trim();
    await updateSettings({
      claudeCodeExecutablePath: trimmed === "" ? null : trimmed,
    });
    setPathDraft(null);
    await refresh();
  };

  return (
    <div className="space-y-4" data-testid="claude-code-settings">
      <ClaudeCodeStatusSummary />
      <p className="text-xs text-muted-foreground">
        {CLAUDE_CODE_CHARGE_DISCLOSURE} Dyad never collects your Claude
        credentials; sign in through the official Claude Code CLI.
      </p>
      <div className="space-y-1">
        <label className="text-xs font-medium" htmlFor="claude-code-cli-path">
          Claude Code executable (optional override)
        </label>
        <div className="flex gap-2">
          <Input
            id="claude-code-cli-path"
            value={value}
            placeholder="Auto-detect on PATH"
            onChange={(event) => setPathDraft(event.target.value)}
            className="h-8 text-xs"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={pathDraft === null || pathDraft === storedPath}
            onClick={() => void savePath()}
          >
            Save
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium">Subscription usage</div>
        <ClaudeCodeUsagePanel />
      </div>
    </div>
  );
}
