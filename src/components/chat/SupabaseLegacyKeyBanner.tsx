import { useAtom } from "jotai";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SkippableBanner } from "./SkippableBanner";
import { dismissedLegacySupabaseKeyAppIdsAtom } from "@/atoms/supabaseAtoms";
import {
  useLegacySupabaseKey,
  useSwitchToPublishableKey,
} from "@/hooks/useLegacySupabaseKey";
import { useLoadApp } from "@/hooks/useLoadApp";
import { useSettings } from "@/hooks/useSettings";
import { isSupabaseConnected } from "@/lib/schemas";
import { showError, showInfo, showSuccess } from "@/lib/toast";

/**
 * Warns, above the chat input, that this app still authenticates with the
 * legacy Supabase key it was generated with — and switches it in one click.
 *
 * The connector card carries the same offer, but only for someone who already
 * went looking in settings. This is the surface the user is actually on, and
 * the app keeps working until Supabase disables legacy keys, at which point
 * every request fails at once with no hint of why.
 *
 * Dismissal is session-only (see `dismissedLegacySupabaseKeyAppIdsAtom`): the
 * problem doesn't go away by being dismissed, so neither does the warning.
 */
export function SupabaseLegacyKeyBanner({ appId }: { appId: number | null }) {
  const { t } = useTranslation("home");
  const { settings } = useSettings();
  const { app } = useLoadApp(appId);
  const [dismissedAppIds, setDismissedAppIds] = useAtom(
    dismissedLegacySupabaseKeyAppIdsAtom,
  );

  const projectId = app?.supabaseProjectId ?? null;
  const isConnected = isSupabaseConnected(settings) && !!projectId;
  const legacyKeyQuery = useLegacySupabaseKey({
    appId,
    projectId,
    enabled: isConnected,
  });
  const switchKey = useSwitchToPublishableKey();

  const isDismissed = appId != null && dismissedAppIds.has(appId);
  // Detection is the gate: it confirms the app's own client holds this
  // project's legacy key and that a publishable key exists to replace it, so
  // the offer never appears without a fix behind it. It self-clears too — the
  // switch invalidates this query, and the re-check comes back false.
  //
  // `isConnected` is re-checked here and not just in the query's `enabled`:
  // disabling a query stops it refetching but keeps its last result, so
  // disconnecting Supabase would otherwise leave a cached `true` on screen
  // offering a migration there is no longer a token to perform.
  const showBanner =
    appId != null &&
    isConnected &&
    !isDismissed &&
    legacyKeyQuery.data?.hasLegacyKey === true;

  const handleDismiss = () => {
    if (appId == null) return;
    setDismissedAppIds((current) => new Set(current).add(appId));
  };

  const handleUpdate = async () => {
    if (appId == null) return;
    try {
      const { outcome } = await switchKey.mutateAsync({ appId });
      if (outcome === "switched") {
        showSuccess(t("integrations.supabase.apiKeyUpdated"));
      } else if (outcome === "already-current") {
        showInfo(t("integrations.supabase.apiKeyAlreadyCurrent"));
      } else {
        // Still on the legacy key, but not one Dyad can swap — saying "already
        // up to date" here would be a plain falsehood.
        showInfo(t("integrations.supabase.apiKeyNotUpdated"));
      }
    } catch (error) {
      showError(error);
    }
  };

  if (!showBanner) {
    return null;
  }

  // Scoped to this app: a switch still in flight for a different app must not
  // put this one's button in a pending state.
  const isSwitching =
    switchKey.isPending && switchKey.variables?.appId === appId;

  return (
    <SkippableBanner
      icon={KeyRound}
      variant="warning"
      message={t("integrations.supabase.legacyApiKeyBanner")}
      enableLabel={
        isSwitching
          ? t("integrations.supabase.updatingApiKey")
          : t("integrations.supabase.updateApiKeyShort")
      }
      enableDisabled={isSwitching}
      onEnable={handleUpdate}
      onSkip={handleDismiss}
      data-testid="supabase-legacy-key-banner"
    />
  );
}
