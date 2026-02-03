import { useAtom, useSetAtom } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { AppList } from "./AppList";
import { ChatList } from "./ChatList";

export function AppsPanel({ show }: { show?: boolean }) {
  const [selectedAppId, setSelectedAppId] = useAtom(selectedAppIdAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const navigate = useNavigate();

  if (!show) {
    return null;
  }

  const handleBack = () => {
    setSelectedAppId(null);
    setSelectedChatId(null);
    navigate({ to: "/" });
  };

  const showingChats = selectedAppId !== null;

  return (
    <div className="relative overflow-hidden h-full">
      <div
        className={`flex transition-transform duration-150 ease-out ${
          showingChats ? "-translate-x-1/2" : "translate-x-0"
        }`}
        style={{ width: "200%" }}
      >
        {/* Left panel: App List */}
        <div className="w-1/2">
          <AppList show={true} />
        </div>
        {/* Right panel: Chat List */}
        <div className="w-1/2">
          <div className="flex flex-col h-full">
            <button
              onClick={handleBack}
              className="mt-4 flex items-center gap-1 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent rounded-md cursor-pointer"
              data-testid="apps-panel-back-button"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>All Apps</span>
            </button>
            <span
              data-floating-app-anchor="sidebar"
              className="block h-7 mx-2"
            />
            <ChatList show={true} />
          </div>
        </div>
      </div>
    </div>
  );
}
