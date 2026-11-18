import { useAtom } from "jotai";
import { dismissedNeonReconnectionAppIdsAtom } from "@/atoms/neonAtoms";
import { useSettings } from "@/hooks/useSettings";
import { useLoadApp } from "@/hooks/useLoadApp";
import { NeonReconnectionNotice } from "../NeonReconnectionNotice";

export function NeonReconnectionBanner({ appId }: { appId: number | null }) {
  const { settings } = useSettings();
  const { app } = useLoadApp(appId);
  const [dismissedAppIds, setDismissedAppIds] = useAtom(
    dismissedNeonReconnectionAppIdsAtom,
  );
  if (
    appId === null ||
    dismissedAppIds.has(appId) ||
    !app?.neonProjectId ||
    !settings ||
    (!settings.neon?.reconnectRequired && settings.neon?.accessToken?.value)
  )
    return null;
  return (
    <div className="px-4 pt-3">
      <NeonReconnectionNotice
        appId={appId}
        onDismiss={() =>
          setDismissedAppIds((current) => new Set(current).add(appId))
        }
      />
    </div>
  );
}
