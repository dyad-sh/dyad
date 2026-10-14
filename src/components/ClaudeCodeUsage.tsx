import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export function ClaudeCodeUsage({ open }: { open: boolean }) {
  const usage = useQuery({
    queryKey: queryKeys.system.claudeCodeUsage,
    queryFn: () => ipc.chat.claudeCodeUsage(),
    enabled: open,
    staleTime: 0,
    refetchInterval: open ? 5_000 : false,
    retry: false,
  });
  const windows = usage.isError
    ? []
    : (usage.data?.windows ?? []).filter(
        (window) => window.resetsAt > Date.now(),
      );

  return (
    <div className="px-2 py-2 space-y-2" aria-label="Claude Code usage limits">
      <p className="text-xs font-medium">Usage limits</p>
      {windows.map((window) => {
        const label = window.name === "five_hour" ? "5-hour" : "Weekly";
        return (
          <div key={window.name} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>{label}</span>
              <span>{Math.round(window.usedPercent)}% used</span>
            </div>
            <progress
              aria-label={`Claude Code ${label} usage`}
              className="w-full h-1.5 accent-primary"
              max={100}
              value={window.usedPercent}
            />
            <p className="text-xs text-muted-foreground">
              Resets {new Date(window.resetsAt).toLocaleString()}
            </p>
          </div>
        );
      })}
      {!windows.length && (
        <p className="text-xs text-muted-foreground">
          {usage.isLoading
            ? "Checking usage…"
            : usage.isError
              ? "Usage unavailable. Try again later."
              : "Send a message to see usage."}
        </p>
      )}
      {!!windows.length && usage.data?.updatedAt != null && (
        <p className="text-xs text-muted-foreground">
          Last reported {new Date(usage.data.updatedAt).toLocaleString()}.
        </p>
      )}
    </div>
  );
}
