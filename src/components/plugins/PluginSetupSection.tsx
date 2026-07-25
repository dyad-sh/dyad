import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CatalogInput } from "@/ipc/types/mcp_catalog";
import type { McpServer } from "@/ipc/types";
import type { McpServerUpdate } from "@/ipc/types/mcp";
import { useOauthCallbackPort } from "./AddPluginDialog";

// A stable key per input, and where its value is stored, both derive from
// `kind` (plus `name` for the ones that address a specific header/var).
function keyOf(input: CatalogInput): string {
  if (input.kind === "header") return `header:${input.name}`;
  if (input.kind === "env") return `env:${input.name}`;
  return input.kind;
}

function labelOf(input: CatalogInput): string {
  if (input.kind === "oauthClientId") return "Client ID";
  if (input.kind === "oauthClientSecret") return "Client secret";
  return input.label;
}

// The client ID is a public identifier; keys and secrets are masked.
function isSecret(input: CatalogInput): boolean {
  return input.kind !== "oauthClientId";
}

/**
 * Collects the values a catalog entry declares it needs, writes each to
 * its column, and enables the server. Shown while a field-requiring
 * server is still disabled.
 */
export function PluginSetupSection({
  server,
  inputs,
  isSaving,
  onSave,
}: {
  server: McpServer;
  inputs: CatalogInput[];
  isSaving: boolean;
  onSave: (update: McpServerUpdate) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const allFilled = inputs.every((input) =>
    (values[keyOf(input)] ?? "").trim(),
  );
  // Only OAuth-client setups need a redirect URI registered at the
  // provider; the port matches the one the connect flow will bind.
  const callbackPort = useOauthCallbackPort();
  const needsCallbackUrl = inputs.some(
    (input) => input.kind === "oauthClientId",
  );

  const save = async () => {
    const update: McpServerUpdate = { id: server.id, enabled: true };
    const headers: Record<string, string> = { ...server.headersJson };
    const env: Record<string, string> = { ...server.envJson };
    let wroteHeader = false;
    let wroteEnv = false;
    for (const input of inputs) {
      const value = (values[keyOf(input)] ?? "").trim();
      if (!value) continue;
      if (input.kind === "oauthClientId") update.oauthClientId = value;
      else if (input.kind === "oauthClientSecret")
        update.oauthClientSecret = value;
      else if (input.kind === "header") {
        headers[input.name] = (input.prefix ?? "") + value;
        wroteHeader = true;
      } else if (input.kind === "env") {
        env[input.name] = value;
        wroteEnv = true;
      }
    }
    // Only touch the columns the entry actually declares inputs for.
    if (wroteHeader) update.headersJson = headers;
    if (wroteEnv) update.envJson = env;
    await onSave(update);
  };

  return (
    <div
      className="mt-4 rounded-lg border border-amber-500/40 bg-amber-50/50 p-4 dark:bg-amber-900/10"
      data-testid="plugin-setup"
    >
      <div className="text-sm font-medium">Finish setup</div>
      <div className="mt-3 space-y-3">
        {inputs.map((input) => {
          const key = keyOf(input);
          // Namespace the DOM id by server so two setups on screen can't
          // share an id.
          const fieldId = `setup-${server.id}-${key}`;
          return (
            <div key={key} className="space-y-1">
              <Label htmlFor={fieldId}>{labelOf(input)}</Label>
              <Input
                id={fieldId}
                type={isSecret(input) ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                value={values[key] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [key]: e.target.value }))
                }
              />
            </div>
          );
        })}
      </div>
      {needsCallbackUrl && (
        <p className="text-muted-foreground mt-3 text-sm">
          Register this as the app's redirect URI at the provider:{" "}
          <code className="text-foreground bg-muted rounded px-1 py-0.5">
            http://localhost:{callbackPort ?? "…"}/callback
          </code>
        </p>
      )}
      <Button
        className="mt-3"
        onClick={() => void save().catch(() => {})}
        disabled={!allFilled || isSaving}
      >
        {isSaving ? "Saving…" : "Save & enable"}
      </Button>
    </div>
  );
}
