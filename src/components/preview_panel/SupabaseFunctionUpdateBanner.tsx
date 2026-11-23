import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Clock } from "lucide-react";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useLoadApp } from "@/hooks/useLoadApp";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/** How often to look for new deploys and expired deadlines. */
const POLL_INTERVAL_MS = 5_000;

function formatNames(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Says when updated edge functions on a self-hosted Supabase instance are
 * guaranteed to be live. Until then a worker started before the deploy can
 * still answer with the previous code.
 */
export function SupabaseFunctionUpdateBanner() {
  const appId = useAtomValue(selectedAppIdAtom);
  const { app } = useLoadApp(appId);
  const projectId = app?.supabaseSelfHosted?.ssh
    ? (app.supabaseProjectId ?? null)
    : null;
  const { data: updates = [] } = useQuery({
    queryKey: queryKeys.supabase.pendingSelfHostedFunctionUpdates({
      projectId,
    }),
    queryFn: () =>
      ipc.supabase.listPendingSelfHostedFunctionUpdates({
        projectId: projectId!,
      }),
    enabled: projectId !== null,
    // Read from memory in the main process, so it works offline.
    networkMode: "always",
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
  });

  if (projectId === null || updates.length === 0) return null;

  const names = updates.map((update) => update.functionName);
  // Rounded up to the minute shown, so the time is never early.
  const latestMs = Math.max(...updates.map((update) => update.liveByMs));
  const liveBy = new Date(
    Math.ceil(latestMs / 60_000) * 60_000,
  ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const message =
    names.length === 1
      ? `The update to ${names[0]} will be live by ${liveBy}. Until then, it may still answer with its previous code.`
      : `The updates to ${formatNames(names)} will be live by ${liveBy}. Until then, they may still answer with their previous code.`;

  return (
    <div
      className="flex min-h-10 items-center gap-3 border-b border-sky-200/80 bg-sky-50/80 px-3 py-2 text-sm text-sky-950 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100"
      data-testid="supabase-function-update-banner"
      role="status"
    >
      <Clock className="size-4 shrink-0 text-sky-700 dark:text-sky-300" />
      <span className="min-w-0 flex-1">{message}</span>
    </div>
  );
}
