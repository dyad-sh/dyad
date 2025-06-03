import { useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { PlusCircle } from "lucide-react";
import { useAtom, useSetAtom } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useLoadApps } from "@/hooks/useLoadApps";

export function AppList({ show }: { show?: boolean }) {
  const navigate = useNavigate();
  const [selectedAppId, setSelectedAppId] = useAtom(selectedAppIdAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const { apps, loading, error } = useLoadApps();

  if (!show) {
    return null;
  }

  const handleAppClick = (id: number) => {
    setSelectedAppId(id);
    setSelectedChatId(null);
    navigate({
      to: "/",
      search: { appId: id },
    });
  };

  const handleNewApp = () => {
    navigate({ to: "/" });
    // We'll eventually need a create app workflow
  };

  return (
    <SidebarGroup className="overflow-y-auto h-[calc(100vh-112px)]">
      <SidebarGroupLabel>Your Apps</SidebarGroupLabel>
      <SidebarGroupContent>
        <div className="flex flex-col space-y-2">
          <Button
            onClick={handleNewApp}
            variant="outline"
            className="flex items-center justify-start gap-2 mx-2 py-2"
          >
            <PlusCircle size={16} />
            <span>New App</span>
          </Button>

          {loading ? (
            <div className="py-2 px-4 text-sm text-gray-500">
              Loading apps...
            </div>
          ) : error ? (
            <div className="py-2 px-4 text-sm text-red-500">
              Error loading apps
            </div>
          ) : apps.length === 0 ? (
            <div className="py-2 px-4 text-sm text-gray-500">No apps found</div>
          ) : (
            <SidebarMenu className="space-y-1" data-testid="app-list">
              {apps.map((app) => (
                <SidebarMenuItem key={app.id} className="mb-1">
                  <Button
                    variant="ghost"
                    onClick={() => handleAppClick(app.id)}
                    className={`justify-start w-full text-left py-3 hover:bg-sidebar-accent/80 ${
                      selectedAppId === app.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : ""
                    }`}
                    data-testid={`app-list-item-${app.name}`}
                  >
                    <div className="flex flex-col w-full">
                      <span className="truncate">{app.name}</span>
                      <span className="text-xs text-gray-500">
                        {formatDistanceToNow(new Date(app.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </Button>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
