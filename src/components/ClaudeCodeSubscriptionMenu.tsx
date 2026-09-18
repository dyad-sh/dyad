import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { ProviderIcon } from "./ProviderIcon";
import { ClaudeCodeUsage } from "./ClaudeCodeUsage";

export function ClaudeCodeSubscriptionMenu({
  connected,
  detail,
  catalogMessage,
  subscriptionSelected,
  onUsageChange,
  onRefresh,
}: {
  connected: boolean;
  detail: string;
  catalogMessage?: string;
  subscriptionSelected: boolean;
  onUsageChange(value: "subscription" | "pro"): Promise<unknown>;
  onRefresh(): void;
}) {
  const [open, setOpen] = useState(false);
  const usage = useMutation({ mutationFn: onUsageChange });
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        className="gap-2"
        openOnHover
        delay={100}
        closeDelay={150}
        aria-label="Claude Code subscription. Open submenu."
      >
        <ProviderIcon providerId="anthropic" />
        Claude Code subscription
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-80 max-w-[calc(100vw-1.5rem)] max-h-(--available-height) overflow-y-auto scrollbar-on-hover">
        <DropdownMenuLabel>Claude Code subscription</DropdownMenuLabel>
        <p className="px-2 py-1 text-xs text-muted-foreground">{detail}</p>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          closeOnClick={false}
          disabled={usage.isPending || (!subscriptionSelected && !connected)}
          onClick={() =>
            usage.mutate(subscriptionSelected ? "pro" : "subscription")
          }
        >
          {subscriptionSelected
            ? "Use API / Pro models"
            : "Use subscription models"}
        </DropdownMenuItem>
        {usage.error && (
          <p role="alert" className="px-2 py-1 text-xs text-destructive">
            {usage.error.message}
          </p>
        )}
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Model usage applies to connected subscriptions. Select a model to
          switch its usage source; existing chats keep their backend.
        </p>
        {connected && <ClaudeCodeUsage open={open} />}
        {catalogMessage && (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            {catalogMessage}
          </p>
        )}
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Claude subscription usage applies. Agent mode with Pro enabled also
          incurs a separate Dyad charge.
        </p>
        <DropdownMenuItem closeOnClick={false} onClick={onRefresh}>
          Refresh connection
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
