import { type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { type SessionDebugBundle, type SystemDebugInfo } from "@/ipc/types";

/** A row of the report the reporter can include or leave out. */
function Disclosure({
  id,
  title,
  visibility,
  subtitle,
  checked,
  onCheckedChange,
  disabled,
  disabledReason,
  onExpand,
  children,
}: {
  id: string;
  title: string;
  visibility: "public" | "private";
  subtitle: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  onExpand?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          className="mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Label htmlFor={id} className="font-medium">
              {title}
            </Label>
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full border ${
                visibility === "public"
                  ? "text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-700 dark:bg-amber-950/30"
                  : "text-muted-foreground border-border bg-(--background-lightest)"
              }`}
            >
              {visibility === "public" ? "Public" : "Private — Dyad team only"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          {disabled && disabledReason && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mt-1">
              <AlertCircleIcon className="h-3 w-3 shrink-0" />
              {disabledReason}
            </p>
          )}
        </div>
      </div>

      <details
        className="text-sm"
        onToggle={(e) => {
          if ((e.currentTarget as HTMLDetailsElement).open) onExpand?.();
        }}
      >
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Show what will be sent
        </summary>
        <div className="mt-2">{children}</div>
      </details>
    </div>
  );
}

/** A collapsible row inside the chat session disclosure. */
function Detail({
  title,
  children,
  data,
  mono = true,
}: {
  title: string;
  children?: ReactNode;
  data?: unknown;
  mono?: boolean;
}) {
  return (
    <details className="border rounded-md p-2">
      <summary className="text-xs font-medium cursor-pointer">{title}</summary>
      <div
        className={`text-xs bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-40 overflow-y-auto mt-2 ${
          mono ? "font-mono" : ""
        } whitespace-pre-wrap`}
      >
        {data !== undefined ? JSON.stringify(data, null, 2) : children}
      </div>
    </details>
  );
}

interface ReportDisclosuresProps {
  diagnostics: string | null;
  diagnosticsFailed: boolean;
  includeSystemInfo: boolean;
  onIncludeSystemInfoChange: (checked: boolean) => void;

  bundle: SessionDebugBundle | null;
  bundleLoading: boolean;
  includeSession: boolean;
  onIncludeSessionChange: (checked: boolean) => void;
  onSessionExpand: () => void;
  sessionUnavailableReason?: string;
}

export function ReportDisclosures({
  diagnostics,
  diagnosticsFailed,
  includeSystemInfo,
  onIncludeSystemInfoChange,
  bundle,
  bundleLoading,
  includeSession,
  onIncludeSessionChange,
  onSessionExpand,
  sessionUnavailableReason,
}: ReportDisclosuresProps) {
  return (
    <div className="space-y-2">
      <Disclosure
        id="include-system-info"
        title="Basic system information and logs"
        visibility="public"
        subtitle="Version, platform, settings and app logs. Logs can include file paths and project names."
        checked={includeSystemInfo}
        onCheckedChange={onIncludeSystemInfoChange}
      >
        <div className="text-xs bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-56 overflow-y-auto font-mono whitespace-pre-wrap">
          {diagnostics ??
            (diagnosticsFailed
              ? "Diagnostics could not be read. Your report will still be filed."
              : "Loading diagnostics...")}
        </div>
      </Disclosure>

      <Disclosure
        id="include-session"
        title="Chat session"
        visibility="private"
        subtitle="Your chat messages and a snapshot of your code, so the team can reproduce it."
        checked={includeSession}
        onCheckedChange={onIncludeSessionChange}
        disabled={Boolean(sessionUnavailableReason)}
        disabledReason={sessionUnavailableReason}
        onExpand={onSessionExpand}
      >
        {bundleLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="h-3 w-3 animate-spin" />
            Loading chat session...
          </div>
        )}
        {bundle && (
          <div className="space-y-1.5">
            <Detail title="Chat Messages" mono={false}>
              {bundle.chat.messages.map((message) => (
                <div key={message.id} className="mb-2">
                  <span className="font-semibold">
                    {message.role === "user" ? "You" : "Assistant"}:{" "}
                  </span>
                  <span>{message.content}</span>
                </div>
              ))}
            </Detail>
            <Detail title="Codebase Snapshot">{bundle.codebase}</Detail>
            <Detail title="Logs">{bundle.logs}</Detail>
            {bundle.updaterLogs && (
              <Detail title="Auto-Updater Logs">{bundle.updaterLogs}</Detail>
            )}
            <Detail title="System Information" mono={false}>
              <p>Dyad Version: {bundle.system.dyadVersion}</p>
              <p>Platform: {bundle.system.platform}</p>
              <p>Architecture: {bundle.system.architecture}</p>
              <p>
                Node Version: {bundle.system.nodeVersion || "Not available"}
              </p>
            </Detail>
            <Detail title="Settings" data={bundle.settings} />
            <Detail title="App Metadata" data={bundle.app} />
            <Detail title="Custom Providers & Models" data={bundle.providers} />
            <Detail title="MCP Servers" data={bundle.mcpServers} />
            {bundle.memoryDiagnostics && (
              <Detail
                title="Memory Diagnostics"
                data={bundle.memoryDiagnostics}
              />
            )}
          </div>
        )}
        {!bundle && !bundleLoading && (
          <p className="text-xs text-muted-foreground">
            Expand to load the session that will be uploaded.
          </p>
        )}
      </Disclosure>
    </div>
  );
}

export type { SystemDebugInfo };
