import { Filter, X, Trash2 } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";

interface ConsoleFiltersProps {
  levelFilter: "all" | "info" | "warn" | "error";
  typeFilter:
    | "all"
    | "server"
    | "client"
    | "edge-function"
    | "network-requests";
  sourceFilter: string;
  onLevelFilterChange: (value: "all" | "info" | "warn" | "error") => void;
  onTypeFilterChange: (
    value: "all" | "server" | "client" | "edge-function" | "network-requests",
  ) => void;
  onSourceFilterChange: (value: string) => void;
  onClearFilters: () => void;
  onClearLogs: () => void;
  uniqueSources: string[];
  totalLogs: number;
  showFilters: boolean;
}

export const ConsoleFilters = ({
  levelFilter,
  typeFilter,
  sourceFilter,
  onLevelFilterChange,
  onTypeFilterChange,
  onSourceFilterChange,
  onClearFilters,
  onClearLogs,
  uniqueSources,
  totalLogs,
  showFilters,
}: ConsoleFiltersProps) => {
  const { t } = useTranslation("home");
  const hasActiveFilters =
    levelFilter !== "all" || typeFilter !== "all" || sourceFilter !== "";

  if (!showFilters) return null;

  return (
    <div className="bg-white dark:bg-gray-950 border-b border-border p-2 flex flex-wrap gap-2 items-center animate-in fade-in slide-in-from-top-2 duration-300">
      <Filter size={14} className="text-gray-500" />

      {/* Level filter */}
      <select
        value={levelFilter}
        onChange={(e) =>
          onLevelFilterChange(
            e.target.value as "all" | "info" | "warn" | "error",
          )
        }
        className="text-xs px-2 py-1 border border-border rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <option value="all">{t("preview.consoleFilters.allLevels")}</option>
        <option value="info">{t("preview.consoleFilters.info")}</option>
        <option value="warn">{t("preview.consoleFilters.warn")}</option>
        <option value="error">{t("preview.consoleFilters.error")}</option>
      </select>

      {/* Type filter */}
      <select
        value={typeFilter}
        onChange={(e) =>
          onTypeFilterChange(
            e.target.value as
              | "all"
              | "server"
              | "client"
              | "edge-function"
              | "network-requests",
          )
        }
        className="text-xs px-2 py-1 border border-border rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <option value="all">{t("preview.consoleFilters.allTypes")}</option>
        <option value="server">{t("preview.consoleFilters.server")}</option>
        <option value="client">{t("preview.consoleFilters.client")}</option>
        <option value="edge-function">
          {t("preview.consoleFilters.edgeFunction")}
        </option>
        <option value="network-requests">
          {t("preview.consoleFilters.networkRequests")}
        </option>
      </select>

      {/* Source filter */}
      {uniqueSources.length > 0 && (
        <select
          value={sourceFilter}
          onChange={(e) => onSourceFilterChange(e.target.value)}
          className="text-xs px-2 py-1 border border-border rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <option value="">{t("preview.consoleFilters.allSources")}</option>
          {uniqueSources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      )}

      {/* Clear filters button */}
      {hasActiveFilters && (
        <button
          onClick={onClearFilters}
          className="text-xs px-2 py-1 flex items-center gap-1 border border-border rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <X size={12} />
          {t("preview.consoleFilters.clearFilters")}
        </button>
      )}

      {/* Clear logs button */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              onClick={onClearLogs}
              className="p-1 border border-border rounded bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              data-testid="clear-logs-button"
            />
          }
        >
          <Trash2 size={14} />
        </TooltipTrigger>
        <TooltipContent>{t("preview.consoleFilters.clearLogs")}</TooltipContent>
      </Tooltip>

      <div className="ml-auto text-xs text-gray-500">
        {totalLogs} {t("preview.consoleFilters.logs")}
      </div>
    </div>
  );
};
