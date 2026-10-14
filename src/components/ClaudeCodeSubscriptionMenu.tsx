import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Info, RefreshCw, TriangleAlert } from "lucide-react";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ProviderIcon } from "./ProviderIcon";
import { ClaudeCodeUsage } from "./ClaudeCodeUsage";

export function ClaudeCodeSubscriptionMenu({
  enabled,
  onEnabledChange,
  connected,
  detail,
  catalogMessage,
  onRefresh,
}: {
  enabled: boolean;
  onEnabledChange(value: boolean): Promise<unknown>;
  connected: boolean;
  detail: string;
  catalogMessage?: string;
  onRefresh(): void;
}) {
  const [open, setOpen] = useState(false);
  const enablement = useMutation({ mutationFn: onEnabledChange });
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        className="gap-2"
        openOnHover
        delay={100}
        closeDelay={150}
        aria-label="Claude Code subscription. Experimental. Open submenu."
      >
        <ProviderIcon providerId="anthropic" />
        <span className="whitespace-nowrap">Claude Code subscription</span>
        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Experimental
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-80 max-w-[calc(100vw-1.5rem)] max-h-(--available-height) overflow-y-auto scrollbar-on-hover">
        <DropdownMenuLabel className="flex items-center gap-2">
          Claude Code
          <Tooltip>
            <TooltipTrigger
              aria-label="Subscription billing details"
              className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <Info className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              Claude subscription limits apply. Pro Agent also uses Dyad
              credits.
            </TooltipContent>
          </Tooltip>
        </DropdownMenuLabel>
        <div className="mx-2 my-1.5 flex items-start gap-2 rounded-md bg-amber-100 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <TriangleAlert
            className="mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
          <p>
            Claude Code uses separate chats. Some features may be unavailable.
          </p>
        </div>
        <DropdownMenuCheckboxItem
          variant="switch"
          closeOnClick={false}
          checked={enabled}
          disabled={enablement.isPending}
          onCheckedChange={(checked) => enablement.mutate(checked)}
        >
          Use Claude subscription
        </DropdownMenuCheckboxItem>
        {enablement.error && (
          <p role="alert" className="px-2 py-1 text-xs text-destructive">
            {enablement.error.message}
          </p>
        )}
        {enabled && (
          <>
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
              {connected ? (
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-emerald-500"
                  />
                  Connected
                </span>
              ) : (
                <span>{detail}</span>
              )}
              <Tooltip>
                <TooltipTrigger
                  aria-label="Refresh connection"
                  onClick={onRefresh}
                  className="ml-auto shrink-0 rounded p-1 hover:bg-accent hover:text-foreground"
                >
                  <RefreshCw className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Refresh connection</TooltipContent>
              </Tooltip>
            </div>
            {connected && (
              <>
                <DropdownMenuSeparator />
                <ClaudeCodeUsage open={open} />
              </>
            )}
            {catalogMessage && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {catalogMessage}
              </p>
            )}
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
