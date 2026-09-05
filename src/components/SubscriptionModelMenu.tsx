import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, type LanguageModel } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { LargeLanguageModel } from "@/lib/schemas";

export function SubscriptionModelMenu({
  open,
  models,
  selected,
  onSelect,
}: {
  open: boolean;
  models: LanguageModel[];
  selected: LargeLanguageModel;
  onSelect: (model: LargeLanguageModel, catalogModel: LanguageModel) => void;
}) {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: queryKeys.settings.codexSubscription,
    queryFn: () => ipc.settings.getCodexSubscriptionStatus(),
    enabled: open,
    refetchInterval: open ? 2000 : false,
    retry: false,
  });
  const action = useMutation({
    mutationFn: (kind: "connect" | "disconnect" | "retry") =>
      kind === "connect"
        ? ipc.settings.connectCodexSubscription({ acceptCharges: true })
        : kind === "disconnect"
          ? ipc.settings.disconnectCodexSubscription()
          : ipc.settings.retryCodexSubscriptionUsage(),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: queryKeys.settings.codexSubscription,
      }),
  });
  const connected = status.data?.connected;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        Subscription{selected.connection === "subscription" ? " ✓" : ""}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-80 max-h-100 overflow-y-auto scrollbar-on-hover">
        <DropdownMenuLabel>ChatGPT subscription · Prototype</DropdownMenuLabel>
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Uses your ChatGPT plan. Dyad separately charges 25% of API list token
          pricing; unknown models cost $0.10 per million tokens. A Dyad Pro key
          is required.
        </p>
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Continue this chat. Your choice applies to the next message.
        </p>
        {(status.error || action.error || status.data?.error) && (
          <p role="alert" className="px-2 py-1 text-xs text-destructive">
            {action.error?.message ??
              status.error?.message ??
              status.data?.error}
          </p>
        )}
        <DropdownMenuItem
          disabled={
            action.isPending || status.isLoading || status.data?.pending
          }
          onClick={(event) => {
            event.preventDefault();
            action.mutate(connected ? "disconnect" : "connect");
          }}
        >
          {status.data?.pending
            ? "Waiting for browser sign-in…"
            : connected
              ? "Disconnect ChatGPT"
              : "Agree to charges and connect ChatGPT"}
        </DropdownMenuItem>
        {status.data?.pending && (
          <DropdownMenuItem
            onClick={(event) => {
              event.preventDefault();
              action.mutate("disconnect");
            }}
          >
            Cancel sign-in
          </DropdownMenuItem>
        )}
        {status.data && (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            Tracked Dyad charges on this device: $
            {status.data.chargedUsd.toFixed(4)} · {status.data.pendingReports}{" "}
            pending reports
          </p>
        )}
        {!!status.data?.pendingReports && (
          <>
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {status.data.missingUsage
                ? "A request ended without usage. Billing reconciliation is required before continuing."
                : "Usage is saved locally. Settle pending reports before the next request."}
            </p>
            <DropdownMenuItem
              disabled={action.isPending}
              onClick={(event) => {
                event.preventDefault();
                action.mutate("retry");
              }}
            >
              Retry usage reporting
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Catalog models below; availability depends on your ChatGPT plan. Other
          Dyad services, including code exploration and review, may use Pro
          credits or configured API keys separately.
        </p>
        {models
          .filter(
            (model) =>
              model.apiName.startsWith("gpt-") &&
              !model.apiName.endsWith("-pro"),
          )
          .map((model) => (
            <DropdownMenuItem
              key={model.apiName}
              disabled={!connected || action.isPending}
              onClick={() =>
                onSelect(
                  {
                    provider: "openai",
                    name: model.apiName,
                    connection: "subscription",
                  },
                  model,
                )
              }
            >
              {model.displayName}
              {selected.connection === "subscription" &&
              selected.name === model.apiName
                ? " ✓"
                : ""}
            </DropdownMenuItem>
          ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
