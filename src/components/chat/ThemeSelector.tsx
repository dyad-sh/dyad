import { PaletteIcon, CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { selectedThemeIdAtom } from "@/atoms/chatAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import type { ThemeDto } from "@/ipc/ipc_types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

// Hook to access themes from other components
export function useThemes() {
  const [themes, setThemes] = useState<ThemeDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadThemes = async () => {
      try {
        const loadedThemes = await IpcClient.getInstance().listThemes();
        setThemes(loadedThemes);
      } catch (error) {
        console.error("[useThemes] Failed to load themes:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadThemes();
  }, []);

  return { themes, isLoading };
}

export function ThemeSelector() {
  const [themes, setThemes] = useState<ThemeDto[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useAtom(selectedThemeIdAtom);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadThemes = async () => {
      try {
        console.log("[ThemeSelector] Loading themes...");
        const loadedThemes = await IpcClient.getInstance().listThemes();
        console.log("[ThemeSelector] Loaded themes:", loadedThemes);

        // If no themes found, try to seed them
        if (loadedThemes.length === 0) {
          console.log("[ThemeSelector] No themes found, attempting to seed...");
          try {
            const count = await IpcClient.getInstance().seedThemes(true);
            console.log(`[ThemeSelector] Seeded ${count} themes`);
            // Reload themes after seeding
            const reloadedThemes = await IpcClient.getInstance().listThemes();
            console.log("[ThemeSelector] Reloaded themes:", reloadedThemes);
            setThemes(reloadedThemes);
            if (selectedThemeId === null && reloadedThemes.length > 0) {
              setSelectedThemeId(reloadedThemes[0].id);
            }
          } catch (seedError) {
            console.error("[ThemeSelector] Failed to seed themes:", seedError);
          }
        } else {
          setThemes(loadedThemes);
          // Auto-select first theme (Default) if none selected
          if (selectedThemeId === null && loadedThemes.length > 0) {
            setSelectedThemeId(loadedThemes[0].id);
          }
        }
      } catch (error) {
        console.error("[ThemeSelector] Failed to load themes:", error);
      } finally {
        setIsLoading(false);
      }
    };
    loadThemes();
  }, [selectedThemeId, setSelectedThemeId]);

  const selectedTheme = themes.find((t) => t.id === selectedThemeId);

  if (isLoading) {
    return null;
  }

  // Show placeholder if no themes available
  if (themes.length === 0) {
    console.warn("[ThemeSelector] No themes found in database");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          data-testid="theme-selector-trigger"
        >
          <PaletteIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {selectedTheme?.title || "Theme"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Design Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {themes.map((theme) => (
          <DropdownMenuItem
            key={theme.id}
            onClick={() => setSelectedThemeId(theme.id)}
            className="flex items-start gap-2 py-2"
            data-testid={`theme-option-${theme.id}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{theme.title}</span>
                {theme.id === selectedThemeId && (
                  <CheckIcon className="h-3.5 w-3.5 text-primary" />
                )}
              </div>
              {theme.description && (
                <p className="text-xs text-muted-foreground truncate">
                  {theme.description}
                </p>
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
