import { formatDistanceToNow } from "date-fns";
import { Star } from "lucide-react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import type { ListedApp } from "@/ipc/types/app";

type AppItemProps = {
  app: ListedApp;
  handleAppClick: (id: number) => void;
  selectedAppId: number | null;
};

export function AppItem({ app, handleAppClick, selectedAppId }: AppItemProps) {
  return (
    <SidebarMenuItem className="mb-1 relative ">
      <div className="flex w-[206px] items-center" title={app.name}>
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
            <div className="flex items-center gap-1">
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
    </SidebarMenuItem>
  );
}
