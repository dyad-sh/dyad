import { formatDistanceToNow } from "date-fns";
import { Pencil, Star } from "lucide-react";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { App } from "@/ipc/ipc_types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useState, useRef, useEffect } from "react";

type AppItemProps = {
  app: App;
  handleAppClick: (id: number) => void;
  selectedAppId: number | null;
  handleToggleFavorite: (appId: number, e: React.MouseEvent) => void;
  isFavoriteLoading: boolean;
  onRenameApp?: (appId: number, newName: string) => void;
  isRenaming?: boolean;
};

export function AppItem({
  app,
  handleAppClick,
  selectedAppId,
  handleToggleFavorite,
  isFavoriteLoading,
  onRenameApp,
  isRenaming: isRenamingProp,
}: AppItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(app.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSubmitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== app.name && onRenameApp) {
      onRenameApp(app.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmitRename();
    } else if (e.key === "Escape") {
      setEditName(app.name);
      setIsEditing(false);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditName(app.name);
    setIsEditing(true);
  };

  return (
    <SidebarMenuItem className="mb-1 relative group">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex w-[190px] items-center">
              <Button
                variant="ghost"
                onClick={() => !isEditing && handleAppClick(app.id)}
                className={`justify-start w-full text-left py-3 hover:bg-sidebar-accent/80 ${
                  selectedAppId === app.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : ""
                }`}
                data-testid={`app-list-item-${app.name}`}
              >
                <div className="flex flex-col w-4/5">
                  {isEditing ? (
                    <Input
                      ref={inputRef}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={handleSubmitRename}
                      onKeyDown={handleKeyDown}
                      onClick={(e) => e.stopPropagation()}
                      className="h-6 px-1 py-0 text-sm"
                      disabled={isRenamingProp}
                    />
                  ) : (
                    <span
                      className="truncate"
                      onDoubleClick={handleDoubleClick}
                    >
                      {app.name}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">
                    {formatDistanceToNow(new Date(app.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </Button>
              {!isEditing && onRenameApp && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditName(app.name);
                    setIsEditing(true);
                  }}
                  className="absolute top-1 right-7 p-1 h-6 w-6 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
                  data-testid="rename-button"
                >
                  <Pencil size={10} />
                </Button>
              )}
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
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{app.name}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </SidebarMenuItem>
  );
}
