import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useSubscriptionAccount } from "@/hooks/useSubscriptionAccount";
import { useSettings } from "@/hooks/useSettings";
import { isDyadProEnabled } from "@/lib/schemas";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Badge } from "./ui/badge";
import {
  CHATGPT_PLAN_LABELS,
  normalizeChatGPTPlanType,
} from "@/lib/subscriptionModels";
import {
  getSubscriptionMenuPlacement,
  type SubscriptionMenuPlacement,
} from "@/lib/subscriptionMenuPlacement";

export function SubscriptionModelMenu({ children }: { children?: ReactNode }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const status = useSubscriptionAccount(open);
  const { settings, updateSettings } = useSettings();
  const fastMode = useMutation({
    mutationFn: (checked: boolean) =>
      updateSettings({ chatgptFastMode: checked }),
  });
  const hasPro = settings && isDyadProEnabled(settings);
  const action = useMutation({
    mutationFn: (kind: "connect" | "disconnect") =>
      kind === "connect"
        ? ipc.settings.connectCodexSubscription({
            acceptCharges: true,
            selectModel: !hasPro,
          })
        : ipc.settings.disconnectCodexSubscription(),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.settings.all });
    },
  });
  const host = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] =
    useState<SubscriptionMenuPlacement>("right");
  useLayoutEffect(() => {
    const menu = host.current?.closest('[data-slot="dropdown-menu-content"]');
    if (!menu) return;
    const measure = () =>
      setPlacement(
        getSubscriptionMenuPlacement(
          menu.getBoundingClientRect(),
          window.innerWidth,
        ),
      );
    measure();
    const frame = requestAnimationFrame(measure);
    const resize = new ResizeObserver(measure);
    resize.observe(menu);
    const position = new MutationObserver(measure);
    if (menu.parentElement)
      position.observe(menu.parentElement, {
        attributes: true,
        attributeFilter: ["style"],
      });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      position.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const inline = placement === "inline";
  useLayoutEffect(() => {
    if (inline && open) back.current?.focus();
  }, [inline, open]);
  const closeInline = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const connected = status.data?.connected;
  const canDisconnect = connected || status.data?.credentialError;
  const planType = normalizeChatGPTPlanType(status.data?.planType);
  const label = (
    <>
      Subscription{" "}
      <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px]">
        New
      </Badge>
    </>
  );
  const accessibleLabel =
    "Subscription, New" +
    (connected ? ", ChatGPT connected" : "") +
    ". Open submenu.";
  const details = (
    <>
      <DropdownMenuLabel className="flex items-center gap-2">
        ChatGPT subscription
        {connected && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {planType ? CHATGPT_PLAN_LABELS[planType] : "Plan unavailable"}
          </Badge>
        )}
      </DropdownMenuLabel>
      <p className="px-2 py-2 text-sm text-muted-foreground">
        {!settings
          ? "Checking Dyad Pro status…"
          : status.data?.credentialError
            ? "Your saved ChatGPT connection could not be opened. Disconnect it to clear the saved connection, then reconnect or use your OpenAI API key."
            : hasPro
              ? connected
                ? "Get up to 5× usage with your ChatGPT subscription."
                : "Get up to 5x usage with Pro credits by connecting your ChatGPT subscription"
              : "Use your ChatGPT subscription with no Dyad usage fees. Basic Agent limits still apply."}
      </p>
      {settings && hasPro && connected && (
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          ChatGPT subscription usage costs up to 1.5 Pro credits / 1M tokens.
        </p>
      )}
      {settings && !hasPro && !canDisconnect && (
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          Connecting sets a ChatGPT model and Agent mode as defaults for new
          chats. Existing chats keep their model selection.
        </p>
      )}
      {settings && connected && !hasPro && (
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          Disconnect ChatGPT to use your OpenAI API key.
        </p>
      )}
      {(status.error ||
        fastMode.error ||
        action.error ||
        status.data?.error ||
        status.data?.setupError) && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          {fastMode.error?.message ??
            action.error?.message ??
            status.error?.message ??
            status.data?.error ??
            status.data?.setupError}
        </p>
      )}
      <DropdownMenuItem
        closeOnClick={false}
        disabled={
          !settings ||
          action.isPending ||
          status.isLoading ||
          status.data?.pending
        }
        onClick={() => action.mutate(canDisconnect ? "disconnect" : "connect")}
      >
        {status.data?.pending
          ? "Waiting for browser sign-in…"
          : canDisconnect
            ? "Disconnect ChatGPT"
            : "Connect with ChatGPT"}
      </DropdownMenuItem>
      {status.data?.pending && (
        <DropdownMenuItem
          closeOnClick={false}
          onClick={() => action.mutate("disconnect")}
        >
          Cancel sign-in
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        closeOnClick={false}
        checked={settings?.chatgptFastMode ?? false}
        disabled={!settings || fastMode.isPending}
        onCheckedChange={(checked) => fastMode.mutate(checked)}
      >
        <div>
          <div>Fast mode</div>
          <p className="text-xs text-muted-foreground">
            Faster responses, 2x ChatGPT usage
          </p>
        </div>
      </DropdownMenuCheckboxItem>
      {connected && status.data && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Usage limits</DropdownMenuLabel>
          {status.data.windows.map((window) => (
            <div key={window.windowSeconds} className="px-2 py-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span>
                  {window.windowSeconds === 18000
                    ? "5-hour"
                    : window.windowSeconds === 604800
                      ? "Weekly"
                      : `${window.windowSeconds / 3600}-hour`}
                </span>
                <span>{Math.round(window.usedPercent)}% used</span>
              </div>
              <progress
                aria-label={`${window.windowSeconds / 3600}-hour usage`}
                className="w-full h-1.5 accent-primary"
                max={100}
                value={Math.min(100, window.usedPercent)}
              />
              <p className="text-xs text-muted-foreground">
                Resets {new Date(window.resetsAt).toLocaleString()}
              </p>
            </div>
          ))}
          {(status.data.limitsError || !status.data.windows.length) && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {status.data.limitsError ??
                "Usage limits are not available for this account."}
            </p>
          )}
          {status.data.modelsError && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              {status.data.modelsError}
            </p>
          )}
        </>
      )}
    </>
  );
  return (
    <div ref={host}>
      {inline ? (
        open ? (
          <div
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "ArrowLeft") {
                event.preventDefault();
                event.stopPropagation();
                closeInline();
              }
            }}
          >
            <DropdownMenuItem
              ref={back}
              closeOnClick={false}
              onClick={closeInline}
            >
              <ArrowLeft className="size-4" /> Back to models
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {details}
          </div>
        ) : (
          <DropdownMenuItem
            ref={trigger}
            closeOnClick={false}
            aria-label={accessibleLabel}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                setOpen(true);
              }
            }}
          >
            {label}
            <ChevronRight className="ml-auto size-4" />
          </DropdownMenuItem>
        )
      ) : (
        <DropdownMenuSub open={open} onOpenChange={setOpen}>
          <DropdownMenuSubTrigger
            openOnHover
            delay={100}
            closeDelay={150}
            aria-label={accessibleLabel}
          >
            {label}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            className="w-80 max-h-(--available-height) overflow-y-auto scrollbar-on-hover"
            side={inline ? "right" : placement}
          >
            {details}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )}
      {!(inline && open) && children}
    </div>
  );
}
