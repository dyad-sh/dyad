import { useAtom, useSetAtom } from "jotai";
import { ArrowLeft } from "lucide-react";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";
import { AppList } from "./AppList";
import { ChatList } from "./ChatList";
import { Button } from "@/components/ui/button";
import { SidebarGroupLabel } from "@/components/ui/sidebar";

export function AppsPanel({ show }: { show?: boolean }) {
  const [selectedAppId, setSelectedAppId] = useAtom(selectedAppIdAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const { apps } = useLoadApps();

  if (!show) {
    return null;
  }

  if (selectedAppId !== null) {
    const app = apps.find((a) => a.id === selectedAppId);

    const handleBack = () => {
      setSelectedAppId(null);
      setSelectedChatId(null);
    };

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-2 py-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="h-8 w-8"
            data-testid="apps-panel-back-button"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <SidebarGroupLabel className="truncate flex-1">
            {app?.name || "App"}
          </SidebarGroupLabel>
        </div>
        <ChatList show={true} />
      </div>
    );
  }

  return <AppList show={true} />;
}
