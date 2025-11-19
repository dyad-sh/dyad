import { formatDistanceToNow } from "date-fns";
import { Star } from "lucide-react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { App } from "@/ipc/ipc_types";

type AppItemProps = {
  app: App;
  handleAppClick: (id: number) => void;
  selectedAppId: number | null;
  handleToggleFavorite: (appId: number, e: React.MouseEvent) => void;
  isFavoriteLoading: boolean;
};

export function AppItem({
  app,
  handleAppClick,
  selectedAppId,
  handleToggleFavorite,
  isFavoriteLoading,
}: AppItemProps) {
  return (
    <SidebarMenuItem className="mb-1 relative ">
      <div className="flex w-[190px] items-center">
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
          <div className="flex flex-col w-4/5">
            <span className="truncate">{app.name}</span>
            <span className="text-xs text-gray-500">
              {formatDistanceToNow(new Date(app.createdAt), {
                addSuffix: true,
              })}
            </span>
          </div>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => handleToggleFavorite(app.id, e)}
          disabled={isFavoriteLoading}
          className="absolute top-1 right-1 p-1 mx-1 h-6 w-6 z-10"
          key={app.id}
          data-testid="favorite-button"
        >
          <Star
            size={12}
            className={
              app.isFavorite
                ? "fill-[#6c55dc] text-[#6c55dc]"
                : selectedAppId === app.id
                  ? "hover:fill-black hover:text-black"
                  : "hover:fill-[#6c55dc] hover:stroke-[#6c55dc] hover:text-[#6c55dc]"
            }
          />
        </Button>
      </div>
    </SidebarMenuItem>
  );
}
