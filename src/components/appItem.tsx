import { formatDistanceToNow } from "date-fns";
import { ExternalLink, Star } from "lucide-react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AppAvatar } from "@/components/AppAvatar";
import type { ListedApp } from "@/ipc/types/app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ipc } from "@/ipc/types";
import { useTranslation } from "react-i18next";
import { showError } from "@/lib/toast";

type AppItemProps = {
  app: ListedApp;
  handleAppClick: (id: number) => void;
  selectedAppId: number | null;
};

export function AppItem({ app, handleAppClick, selectedAppId }: AppItemProps) {
  const { t } = useTranslation("home");
  return (
    <SidebarMenuItem className="mb-1 relative ">
      <ContextMenu>
        <ContextMenuTrigger>
          <div className="flex w-[206px] items-center" title={app.name}>
            <Button
              variant="ghost"
              onClick={() => handleAppClick(app.id)}
              className={`flex w-full justify-start gap-2 py-3 text-left hover:bg-sidebar-accent/80 ${
                selectedAppId === app.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : ""
              }`}
              data-testid={`app-list-item-${app.name}`}
            >
              <AppAvatar appId={app.id} name={app.name} />
              <div className="flex min-w-0 flex-1 flex-col items-start">
                <div className="flex w-full items-center gap-1">
                  <span className="truncate">{app.name}</span>
                  {app.isFavorite && (
                    <Star
                      size={12}
                      className="fill-[#6c55dc] text-[#6c55dc] flex-shrink-0"
                    />
                  )}
                </div>
                <span className="text-xs text-gray-500">
                  {formatDistanceToNow(new Date(app.createdAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            </Button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onClick={() =>
              void ipc.windowInfrastructure
                .openEntityInNewWindow({
                  kind: "app",
                  id: app.id,
                })
                .catch(showError)
            }
          >
            <ExternalLink size={14} />
            {t("openInNewWindow")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </SidebarMenuItem>
  );
}
