import { useState, useMemo } from "react";
import {
  Plus,
  Paperclip,
  ChartColumnIncreasing,
  Palette,
  Check,
  Ban,
  Brush,
  PlusCircle,
  MoreHorizontal,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContextFilesPicker } from "@/components/ContextFilesPicker";
import { FileAttachmentDropdown } from "./FileAttachmentDropdown";
import { CustomThemeDialog } from "@/components/CustomThemeDialog";
import { useThemes } from "@/hooks/useThemes";
import { useAppTheme } from "@/hooks/useAppTheme";
import { useCustomThemes } from "@/hooks/useCustomThemes";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

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
  const [customThemeDialogOpen, setCustomThemeDialogOpen] = useState(false);
  const [allThemesDialogOpen, setAllThemesDialogOpen] = useState(false);
  const { themes } = useThemes();
  const { customThemes } = useCustomThemes();
  const { themeId: appThemeId } = useAppTheme(appId);
  const { settings, updateSettings } = useSettings();
  const queryClient = useQueryClient();

  // Determine current theme: use app theme if appId exists, otherwise use settings
  // Note: settings stores empty string for "no theme", convert to null
  const currentThemeId =
    appId != null ? appThemeId : settings?.selectedThemeId || null;

  // Compute visible custom themes: selected custom theme + up to 3 others
  const visibleCustomThemes = useMemo(() => {
    const MAX_VISIBLE = 4; // selected + 3 others

    // Check if current theme is a custom theme
    const selectedCustomTheme = customThemes.find(
      (t) => `custom:${t.id}` === currentThemeId,
    );
    const otherCustomThemes = customThemes.filter(
      (t) => `custom:${t.id}` !== currentThemeId,
    );

    const result = [];
    if (selectedCustomTheme) {
      result.push(selectedCustomTheme);
    }

    // Add up to (MAX_VISIBLE - result.length) other custom themes
    const remaining = MAX_VISIBLE - result.length;
    result.push(...otherCustomThemes.slice(0, remaining));

    return result;
  }, [customThemes, currentThemeId]);

  const hasMoreCustomThemes = customThemes.length > visibleCustomThemes.length;

  const handleThemeSelect = async (themeId: string | null) => {
    if (appId != null) {
      // Update app-specific theme
      await ipc.template.setAppTheme({
        appId,
        themeId,
      });
      // Invalidate app theme query to refresh
      queryClient.invalidateQueries({
        queryKey: queryKeys.appTheme.byApp({ appId }),
      });
    } else {
      // Update default theme in settings (for new apps)
      // Store as string for settings (empty string for no theme)
      await updateSettings({ selectedThemeId: themeId ?? "" });
    }
  };

  const handleCreateCustomTheme = () => {
    setIsOpen(false);
    setCustomThemeDialogOpen(true);
  };

  const handleCustomThemeDialogClose = (open: boolean) => {
    setCustomThemeDialogOpen(open);
    if (!open) {
      // Refresh custom themes when dialog closes
      queryClient.invalidateQueries({
        queryKey: queryKeys.customThemes.all,
      });
    }
  };

  return (
    <>
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger
          className="inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-muted bg-primary/10 text-primary cursor-pointer h-8 px-2"
          data-testid="auxiliary-actions-menu"
        >
          <Plus
            size={20}
            className={`transition-transform duration-200 ${isOpen ? "rotate-45" : "rotate-0"}`}
          />
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
              <DropdownMenuItem
                onClick={() => handleThemeSelect(null)}
                className={`py-2 px-3 ${currentThemeId === null ? "bg-primary/10" : ""}`}
                data-testid="theme-option-none"
              >
                <div className="flex items-center w-full">
                  <Ban size={16} className="mr-2 text-muted-foreground" />
                  <span className="flex-1">No Theme</span>
                  {currentThemeId === null && (
                    <Check size={16} className="text-primary ml-2" />
                  )}
                </div>
              </DropdownMenuItem>

              {/* Built-in themes from themesData */}
              {themes?.map((theme) => {
                const isSelected = currentThemeId === theme.id;
                return (
                  <DropdownMenuItem
                    key={theme.id}
                    onClick={() => handleThemeSelect(theme.id)}
                    className={`py-2 px-3 ${isSelected ? "bg-primary/10" : ""}`}
                    data-testid={`theme-option-${theme.id}`}
                    title={theme.description}
                  >
                    <div className="flex items-center w-full">
                      {theme.icon === "palette" && (
                        <Palette
                          size={16}
                          className="mr-2 text-muted-foreground"
                        />
                      )}
                      <span className="flex-1">{theme.name}</span>
                      {isSelected && (
                        <Check size={16} className="text-primary ml-2" />
                      )}
                    </div>
                  </DropdownMenuItem>
                );
              })}

              {/* Custom Themes Section (limited) */}
              {visibleCustomThemes.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  {visibleCustomThemes.map((theme) => {
                    const themeId = `custom:${theme.id}`;
                    const isSelected = currentThemeId === themeId;
                    return (
                      <DropdownMenuItem
                        key={themeId}
                        onClick={() => handleThemeSelect(themeId)}
                        className={`py-2 px-3 ${isSelected ? "bg-primary/10" : ""}`}
                        data-testid={`theme-option-${themeId}`}
                        title={theme.description || "Custom theme"}
                      >
                        <div className="flex items-center w-full">
                          <Brush
                            size={16}
                            className="mr-2 text-muted-foreground"
                          />
                          <span className="flex-1">{theme.name}</span>
                          {isSelected && (
                            <Check size={16} className="text-primary ml-2" />
                          )}
                        </div>
                      </DropdownMenuItem>
                    );
                  })}
                </>
              )}

              {/* All Custom Themes option */}
              {hasMoreCustomThemes && (
                <DropdownMenuItem
                  onClick={() => {
                    setIsOpen(false);
                    setAllThemesDialogOpen(true);
                  }}
                  className="py-2 px-3"
                  data-testid="all-custom-themes-option"
                >
                  <div className="flex items-center w-full">
                    <MoreHorizontal
                      size={16}
                      className="mr-2 text-muted-foreground"
                    />
                    <span className="flex-1">More themes</span>
                  </div>
                </DropdownMenuItem>
              )}

              {/* Create Custom Theme option (always available) */}
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleCreateCustomTheme}
                  className="py-2 px-3"
                  data-testid="create-custom-theme"
                >
                  <div className="flex items-center w-full">
                    <PlusCircle
                      size={16}
                      className="mr-2 text-muted-foreground"
                    />
                    <span className="flex-1">New Theme</span>
                  </div>
                </DropdownMenuItem>
              </>
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

      {/* Custom Theme Dialog */}
      <CustomThemeDialog
        open={customThemeDialogOpen}
        onOpenChange={handleCustomThemeDialogClose}
        onThemeCreated={(themeId) => {
          // Auto-select the newly created theme
          handleThemeSelect(`custom:${themeId}`);
        }}
      />

      {/* All Custom Themes Dialog */}
      <Dialog open={allThemesDialogOpen} onOpenChange={setAllThemesDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>All Custom Themes</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-6 px-6">
            {/* All custom themes list */}
            {customThemes.map((theme) => {
              const themeId = `custom:${theme.id}`;
              const isSelected = currentThemeId === themeId;
              return (
                <div
                  key={themeId}
                  onClick={() => {
                    handleThemeSelect(themeId);
                    setAllThemesDialogOpen(false);
                  }}
                  className={`flex items-center p-3 rounded-lg cursor-pointer hover:bg-muted transition-colors ${
                    isSelected ? "bg-primary/10" : ""
                  }`}
                >
                  <Brush size={18} className="mr-3 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">{theme.name}</div>
                    {theme.description && (
                      <div className="text-sm text-muted-foreground">
                        {theme.description}
                      </div>
                    )}
                  </div>
                  {isSelected && <Check size={18} className="text-primary" />}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
