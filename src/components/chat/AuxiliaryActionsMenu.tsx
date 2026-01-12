import { useState } from "react";
import {
  Plus,
  Paperclip,
  ChartColumnIncreasing,
  Palette,
  Check,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ContextFilesPicker } from "@/components/ContextFilesPicker";
import { FileAttachmentDropdown } from "./FileAttachmentDropdown";
import { useThemes } from "@/hooks/useThemes";
import { useAppTheme, APP_THEME_QUERY_KEY } from "@/hooks/useAppTheme";
import { useSettings } from "@/hooks/useSettings";
import { IpcClient } from "@/ipc/ipc_client";
import { useQueryClient } from "@tanstack/react-query";

interface AuxiliaryActionsMenuProps {
  onFileSelect: (
    files: FileList,
    type: "chat-context" | "upload-to-codebase",
  ) => void;
  showTokenBar?: boolean;
  toggleShowTokenBar?: () => void;
  hideContextFilesPicker?: boolean;
  appId?: number;
}

export function AuxiliaryActionsMenu({
  onFileSelect,
  showTokenBar,
  toggleShowTokenBar,
  hideContextFilesPicker,
  appId,
}: AuxiliaryActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { themes } = useThemes();
  const { themeId: appThemeId } = useAppTheme(appId);
  const { settings, updateSettings } = useSettings();
  const queryClient = useQueryClient();

  // Determine current theme: use app theme if appId exists, otherwise use settings
  // Note: settings stores empty string for "no theme", convert to null
  const currentThemeId = appId ? appThemeId : settings?.selectedThemeId || null;

  const handleThemeSelect = async (themeId: string | null) => {
    if (appId) {
      // Update app-specific theme
      await IpcClient.getInstance().setAppTheme({
        appId,
        themeId,
      });
      // Invalidate app theme query to refresh
      queryClient.invalidateQueries({ queryKey: APP_THEME_QUERY_KEY(appId) });
    } else {
      // Update default theme in settings (for new apps)
      // Store as string for settings (empty string for no theme)
      await updateSettings({ selectedThemeId: themeId ?? "" });
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="has-[>svg]:px-2 hover:bg-muted bg-primary/10 text-primary cursor-pointer rounded-xl"
          data-testid="auxiliary-actions-menu"
        >
          <Plus
            size={20}
            className={`transition-transform duration-200 ${isOpen ? "rotate-45" : "rotate-0"}`}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Codebase Context */}
        {!hideContextFilesPicker && <ContextFilesPicker />}

        {/* Attach Files Submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-2 px-3">
            <Paperclip size={16} className="mr-2" />
            Attach files
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <FileAttachmentDropdown
              onFileSelect={onFileSelect}
              closeMenu={() => setIsOpen(false)}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Themes Submenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-2 px-3">
            <Palette size={16} className="mr-2" />
            Themes
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {/* No Theme option (special frontend-only option) */}
            <DropdownMenuItem
              onClick={() => handleThemeSelect(null)}
              className={`py-2 px-3 ${currentThemeId === null ? "bg-primary/10" : ""}`}
              data-testid="theme-option-none"
            >
              <div className="flex items-center w-full">
                <span className="flex-1">No Theme</span>
                {currentThemeId === null && (
                  <Check size={16} className="text-primary ml-2" />
                )}
              </div>
            </DropdownMenuItem>

            {/* Actual themes from themesData */}
            {themes?.map((theme) => {
              const isSelected = currentThemeId === theme.id;
              return (
                <DropdownMenuItem
                  key={theme.id}
                  onClick={() => handleThemeSelect(theme.id)}
                  className={`py-2 px-3 ${isSelected ? "bg-primary/10" : ""}`}
                  data-testid={`theme-option-${theme.id}`}
                >
                  <div className="flex items-center w-full">
                    <span className="flex-1">{theme.name}</span>
                    {isSelected && (
                      <Check size={16} className="text-primary ml-2" />
                    )}
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {toggleShowTokenBar && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={toggleShowTokenBar}
              className={`py-2 px-3 group ${showTokenBar ? "bg-primary/10 text-primary" : ""}`}
              data-testid="token-bar-toggle"
            >
              <ChartColumnIncreasing
                size={16}
                className={
                  showTokenBar
                    ? "text-primary group-hover:text-accent-foreground"
                    : ""
                }
              />
              <span className="flex-1">
                {showTokenBar ? "Hide" : "Show"} token usage
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
