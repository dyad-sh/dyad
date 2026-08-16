import { useEffect } from "react";

import { ipc } from "@/ipc/types";
import { useSettings } from "@/hooks/useSettings";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { useTheme } from "@/contexts/ThemeContext";
import { isSupabaseConnected } from "@/lib/schemas";
import { SupabaseIntegration } from "@/components/SupabaseIntegration";

// @ts-ignore - SVG import handled by Vite
import connectSupabaseDark from "../../../assets/supabase/connect-supabase-dark.svg";
// @ts-ignore - SVG import handled by Vite
import connectSupabaseLight from "../../../assets/supabase/connect-supabase-light.svg";

const SUPABASE_OAUTH_LOGIN_URL =
  "https://supabase-oauth.dyad.sh/api/connect-supabase/login";

/**
 * Supabase connection management for Settings → Plugins → Integrations.
 *
 * Unlike <SupabaseConnector>, this is app-independent: it connects the Supabase
 * account globally (organizations are stored in settings). When connected it
 * renders the existing management UI; otherwise it shows the connect button.
 */
export function SupabaseConnectionSettings() {
  const { settings, refreshSettings } = useSettings();
  const { isDarkMode } = useTheme();
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();

  const isConnected = isSupabaseConnected(settings);

  // Refresh settings when the Supabase OAuth flow returns via deep link.
  useEffect(() => {
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "supabase-oauth-return") {
        await refreshSettings();
        clearLastDeepLink();
      }
    };
    void handleDeepLink();
    // Keyed on the deep-link timestamp so this runs once per incoming deep link.
    // eslint-disable-next-line react/exhaustive-deps
  }, [lastDeepLink?.timestamp]);

  const handleConnect = async () => {
    await ipc.system.openExternalUrl(SUPABASE_OAUTH_LOGIN_URL);
  };

  if (isConnected) {
    return <SupabaseIntegration />;
  }

  return (
    <div>
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
        Supabase
      </h3>
      <p className="mt-1 mb-3 text-xs text-gray-500 dark:text-gray-400">
        Connect your Supabase account to add a Postgres database, auth, and
        storage to your apps.
      </p>
      <img
        onClick={handleConnect}
        src={isDarkMode ? connectSupabaseDark : connectSupabaseLight}
        alt="Connect to Supabase"
        className="h-10 min-h-8 w-auto min-w-20 cursor-pointer"
        data-testid="connect-supabase-button"
      />
    </div>
  );
}
