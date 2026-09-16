import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Gitlab } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { isSecureInstanceUrl } from "@/ipc/types/coolify";
import {
  GITLAB_COM_URL,
  isGitLabInstanceUrl,
  normalizeGitLabInstanceUrl,
} from "@/shared/gitlab_instance_url";

/**
 * Where a GitLab instance and a personal access token are entered.
 *
 * One form for gitlab.com and self-hosted: the address is prefilled with
 * gitlab.com and anyone with their own instance overwrites it. Rendered both
 * in Settings and inside the Publish panel, so a user who is already looking
 * at their app does not have to leave it to connect.
 */
export function GitLabCredentialsForm({
  onConnected,
  defaultInstanceUrl,
}: {
  onConnected?: () => void;
  /** Prefilled when the app is already linked to a known instance. */
  defaultInstanceUrl?: string | null;
}) {
  const { t } = useTranslation(["home", "common"]);
  const queryClient = useQueryClient();
  const [instanceUrl, setInstanceUrl] = useState(
    defaultInstanceUrl ?? GITLAB_COM_URL,
  );
  const [token, setToken] = useState("");
  const [acknowledgedInsecure, setAcknowledgedInsecure] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validUrl = isGitLabInstanceUrl(instanceUrl);
  const insecure = validUrl && !isSecureInstanceUrl(instanceUrl);
  const tokenPageUrl = validUrl
    ? `${normalizeGitLabInstanceUrl(instanceUrl)}/-/user_settings/personal_access_tokens?name=Dyad&scopes=api`
    : null;

  const connect = useMutation({
    mutationFn: () =>
      ipc.gitlab.saveToken({ instanceUrl, token, acknowledgedInsecure }),
    onSuccess: async () => {
      setError(null);
      setToken("");
      // The handler publishes an invalidation to every window; refreshing
      // here as well means this window does not wait a round trip to show
      // the connected state it just caused.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.gitlab.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.user }),
      ]);
      onConnected?.();
    },
    onError: (err: Error) => {
      setError(err.message || "Could not connect to GitLab.");
    },
  });

  const canSubmit =
    validUrl &&
    token.trim().length > 0 &&
    (!insecure || acknowledgedInsecure) &&
    !connect.isPending;

  return (
    <form
      className="space-y-3"
      data-testid="gitlab-credentials-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) connect.mutate();
      }}
    >
      <div>
        <Label htmlFor="gitlab-instance-url" className="text-sm font-medium">
          {t("integrations.gitlab.instanceUrl")}
        </Label>
        <Input
          id="gitlab-instance-url"
          data-testid="gitlab-instance-url-input"
          className="mt-1 w-full"
          value={instanceUrl}
          onChange={(event) => {
            setInstanceUrl(event.target.value);
            setAcknowledgedInsecure(false);
          }}
          placeholder={GITLAB_COM_URL}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {t("integrations.gitlab.instanceUrlHint")}
        </p>
      </div>

      <div>
        <Label htmlFor="gitlab-token" className="text-sm font-medium">
          {t("integrations.gitlab.token")}
        </Label>
        <Input
          id="gitlab-token"
          data-testid="gitlab-token-input"
          className="mt-1 w-full"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="glpat-…"
          autoComplete="off"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {t("integrations.gitlab.tokenHint")}{" "}
          {tokenPageUrl && (
            <a
              href={tokenPageUrl}
              onClick={(event) => {
                event.preventDefault();
                ipc.system.openExternalUrl(tokenPageUrl);
              }}
              className="cursor-pointer text-blue-600 hover:underline dark:text-blue-400"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("integrations.gitlab.createToken")}
            </a>
          )}
        </p>
      </div>

      {insecure && (
        <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          <Checkbox
            data-testid="gitlab-insecure-ack"
            checked={acknowledgedInsecure}
            onCheckedChange={(checked) =>
              setAcknowledgedInsecure(checked === true)
            }
            className="mt-0.5"
          />
          <span>{t("integrations.gitlab.insecureAck")}</span>
        </label>
      )}

      {error && (
        <p
          className="text-sm text-red-600 dark:text-red-400"
          data-testid="gitlab-credentials-error"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        data-testid="gitlab-connect-button"
        disabled={!canSubmit}
        className="flex items-center gap-2"
      >
        {connect.isPending
          ? t("integrations.gitlab.connecting")
          : t("integrations.gitlab.connect")}
        <Gitlab className="h-4 w-4" />
      </Button>
    </form>
  );
}
