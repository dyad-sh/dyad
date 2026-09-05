import { SubscriptionModelMenu } from "./SubscriptionModelMenu";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import type { LanguageModel, LanguageModelProvider } from "@/ipc/types";
import type { LargeLanguageModel } from "@/lib/schemas";

export function ConnectionModelMenu({
  open,
  selected,
  modelsByProviders,
  providers,
  proEnabled,
  isProviderSetup,
  onSelect,
  onSetup,
  onUpgrade,
}: {
  open: boolean;
  selected: LargeLanguageModel;
  modelsByProviders: Record<string, LanguageModel[]>;
  providers: LanguageModelProvider[];
  proEnabled: boolean;
  isProviderSetup: (id: string) => boolean;
  onSelect: (model: LargeLanguageModel, catalog: LanguageModel) => void;
  onSetup: (provider: string, model: LanguageModel) => void;
  onUpgrade: () => void;
}) {
  return (
    <>
      <DropdownMenuLabel>Connection for your next message</DropdownMenuLabel>
      <SubscriptionModelMenu
        open={open}
        models={modelsByProviders.openai ?? []}
        selected={selected}
        onSelect={onSelect}
      />
      {(["pro", "api-key"] as const).map((connection) => (
        <DropdownMenuSub key={connection}>
          <DropdownMenuSubTrigger>
            {connection === "pro" ? "Pro credits" : "API key"}
            {selected.connection === connection ? " ✓" : ""}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-80 max-h-100 overflow-y-auto scrollbar-on-hover">
            <DropdownMenuLabel>
              {connection === "pro"
                ? "Pay with Dyad Pro credits"
                : "Pay your provider directly"}
            </DropdownMenuLabel>
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Continue this chat. Applies to the next message.
            </p>
            {connection === "pro" && !proEnabled && (
              <DropdownMenuItem onClick={onUpgrade}>
                Enable Dyad Pro
              </DropdownMenuItem>
            )}
            {Object.entries(modelsByProviders)
              .filter(([id]) =>
                connection === "pro"
                  ? providers.some(
                      (p) => p.id === id && p.gatewayPrefix != null,
                    )
                  : id !== "auto",
              )
              .map(([id, models]) => (
                <DropdownMenuSub key={id}>
                  <DropdownMenuSubTrigger>
                    {providers.find((p) => p.id === id)?.name ?? id}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-80 max-h-100 overflow-y-auto scrollbar-on-hover">
                    {models
                      .filter(
                        (m) =>
                          connection !== "pro" ||
                          (!m.apiName.endsWith(":free") &&
                            !m.apiName.endsWith("/free")),
                      )
                      .map((model) => (
                        <DropdownMenuItem
                          key={model.apiName}
                          disabled={connection === "pro" && !proEnabled}
                          onClick={() => {
                            if (
                              connection === "api-key" &&
                              !isProviderSetup(id)
                            ) {
                              onSetup(id, model);
                              return;
                            }
                            onSelect(
                              {
                                provider: id,
                                name: model.apiName,
                                connection,
                                ...(model.type === "custom"
                                  ? { customModelId: model.id }
                                  : {}),
                              },
                              model,
                            );
                          }}
                        >
                          {model.displayName}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ))}
      <DropdownMenuSeparator />
    </>
  );
}
