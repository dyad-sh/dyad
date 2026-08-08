import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";

interface NeonDisconnectButtonProps {
  className?: string;
}

export function NeonDisconnectButton({ className }: NeonDisconnectButtonProps) {
  const { t } = useTranslation("home");
  const { updateSettings, settings } = useSettings();

  const handleDisconnect = async () => {
    try {
      await updateSettings({
        neon: undefined,
      });
      toast.success(t("integrations.neon.disconnected"));
    } catch (error) {
      console.error("Failed to disconnect from Neon:", error);
      toast.error(t("integrations.neon.failedDisconnect"));
    }
  };

  if (!settings?.neon?.accessToken) {
    return null;
  }

  return (
    <Button
      variant="destructive"
      onClick={handleDisconnect}
      className={className}
      size="sm"
    >
      {t("integrations.neon.disconnect")}
    </Button>
  );
}
