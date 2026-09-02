import { type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { type SessionDebugBundle, type SystemDebugInfo } from "@/ipc/types";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(["home", "common"]);
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={id}
          // The visible control is a span; the id lands on a hidden input, so
          // without this the checkbox has no accessible name of its own.
          aria-label={title}
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
              {visibility === "public"
                ? t("home:report.public")
                : t("home:report.private")}
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
          {t("home:report.showWhatWillBeSent")}
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
  /** Locked once filing starts, since the choice has already been acted on. */
  locked: boolean;
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
  locked,
}: ReportDisclosuresProps) {
  const { t } = useTranslation(["home", "common"]);
  return (
    <div className="space-y-2">
      <Disclosure
        id="include-system-info"
        title={t("home:report.systemTitle")}
        visibility="public"
        subtitle={t("home:report.systemSubtitle")}
        checked={includeSystemInfo}
        onCheckedChange={onIncludeSystemInfoChange}
        disabled={locked}
      >
        <div className="text-xs bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-56 overflow-y-auto font-mono whitespace-pre-wrap">
          {diagnostics ??
            (diagnosticsFailed
              ? t("home:report.diagnosticsFailed")
              : t("home:report.diagnosticsLoading"))}
        </div>
      </Disclosure>

      <Disclosure
        id="include-session"
        title={t("home:report.sessionTitle")}
        visibility="private"
        subtitle={t("home:report.sessionSubtitle")}
        checked={includeSession}
        onCheckedChange={onIncludeSessionChange}
        disabled={locked || Boolean(sessionUnavailableReason)}
        disabledReason={sessionUnavailableReason}
        onExpand={onSessionExpand}
      >
        {bundleLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2Icon className="h-3 w-3 animate-spin" />
            {t("home:report.sessionLoading")}
          </div>
        )}
        {bundle && (
          <div className="space-y-1.5">
            <Detail title={t("home:help.chatMessages")} mono={false}>
              {bundle.chat.messages.map((message) => (
                <div key={message.id} className="mb-2">
                  <span className="font-semibold">
                    {message.role === "user"
                      ? t("home:help.you")
                      : t("home:help.assistant")}
                    :{" "}
                  </span>
                  <span>{message.content}</span>
                </div>
              ))}
            </Detail>
            <Detail title={t("home:help.codebaseSnapshot")}>
              {bundle.codebase}
            </Detail>
            <Detail title={t("home:help.logs")}>{bundle.logs}</Detail>
            {bundle.updaterLogs && (
              <Detail title={t("home:report.updaterLogs")}>
                {bundle.updaterLogs}
              </Detail>
            )}
            <Detail title={t("home:help.systemInformation")} mono={false}>
              <p>
                {t("home:help.dyadVersion")} {bundle.system.dyadVersion}
              </p>
              <p>
                {t("home:help.platform")} {bundle.system.platform}
              </p>
              <p>
                {t("home:help.architecture")} {bundle.system.architecture}
              </p>
              <p>
                {t("home:help.nodeVersion")}{" "}
                {bundle.system.nodeVersion || t("home:report.notAvailable")}
              </p>
            </Detail>
            <Detail
              title={t("home:report.settingsLabel")}
              data={bundle.settings}
            />
            <Detail title={t("home:report.appMetadata")} data={bundle.app} />
            <Detail
              title={t("home:report.providers")}
              data={bundle.providers}
            />
            <Detail
              title={t("home:report.mcpServers")}
              data={bundle.mcpServers}
            />
            {bundle.memoryDiagnostics && (
              <Detail
                title={t("home:report.memoryDiagnostics")}
                data={bundle.memoryDiagnostics}
              />
            )}
          </div>
        )}
        {!bundle && !bundleLoading && (
          <p className="text-xs text-muted-foreground">
            {t("home:report.sessionExpand")}
          </p>
        )}
      </Disclosure>
    </div>
  );
}

export type { SystemDebugInfo };
