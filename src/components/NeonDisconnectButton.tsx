import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";

interface NeonDisconnectButtonProps {
  className?: string;
}

export function NeonDisconnectButton({ className }: NeonDisconnectButtonProps) {
  const { updateSettings, settings } = useSettings();

  const handleDisconnect = async () => {
    try {
      await updateSettings({
        neon: undefined,
      });
      toast.success("Disconnected from Neon successfully");
    } catch (error) {
      console.error("Failed to disconnect from Neon:", error);
      toast.error("Failed to disconnect from Neon");
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
      Disconnect from Neon
    </Button>
  );
}
