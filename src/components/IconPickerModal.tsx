import { lazy, Suspense, useState, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { AppIcon } from "@/components/ui/AppIcon";
import { Loader2, RefreshCw } from "lucide-react";
import {
  generateAvatarSeed,
  generateAvatarConfig,
  getAvatarProperties,
} from "@/lib/avatarGenerator";
import type { IconType } from "@/ipc/types/app";
import { useTheme } from "@/contexts/ThemeContext";

// Lazy load emoji-mart for better initial load performance
const EmojiPicker = lazy(async () => {
  const [{ default: Picker }, { default: data }] = await Promise.all([
    import("@emoji-mart/react"),
    import("@emoji-mart/data"),
  ]);
  return {
    default: (props: any) => <Picker data={data} {...props} />,
  };
});

interface IconPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: number;
  appName: string;
  currentIconType: IconType | null;
  currentIconData: string | null;
  onSave: (iconType: IconType, iconData: string) => void;
}

// Pre-generate some avatar options for selection
function generateAvatarOptions(
  appId: number,
  appName: string,
  count: number = 8,
): Array<{ seed: string; config: string }> {
  const options: Array<{ seed: string; config: string }> = [];
  for (let i = 0; i < count; i++) {
    const seed = generateAvatarSeed(appId, `${appName}-${i}-${Date.now()}`);
    const config = generateAvatarConfig(seed);
    options.push({ seed, config: JSON.stringify(config) });
  }
  return options;
}

export function IconPickerModal({
  open,
  onOpenChange,
  appId,
  appName,
  currentIconType,
  currentIconData,
  onSave,
}: IconPickerModalProps) {
  const { isDarkMode } = useTheme();
  const [selectedType, setSelectedType] = useState<IconType>(
    currentIconType || "generated",
  );
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(
    currentIconType === "emoji" ? currentIconData : null,
  );
  const [selectedAvatarConfig, setSelectedAvatarConfig] = useState<
    string | null
  >(currentIconType === "generated" ? currentIconData : null);
  const [avatarOptions, setAvatarOptions] = useState(() =>
    generateAvatarOptions(appId, appName),
  );

  const handleRegenerateAvatars = useCallback(() => {
    setAvatarOptions(generateAvatarOptions(appId, appName));
  }, [appId, appName]);

  const handleEmojiSelect = useCallback((emoji: any) => {
    setSelectedEmoji(emoji.native);
    setSelectedType("emoji");
  }, []);

  const handleAvatarSelect = useCallback((config: string) => {
    setSelectedAvatarConfig(config);
    setSelectedType("generated");
  }, []);

  const handleSave = useCallback(() => {
    if (selectedType === "emoji" && selectedEmoji) {
      onSave("emoji", selectedEmoji);
      onOpenChange(false);
    } else if (selectedType === "generated" && selectedAvatarConfig) {
      onSave("generated", selectedAvatarConfig);
      onOpenChange(false);
    }
  }, [selectedType, selectedEmoji, selectedAvatarConfig, onSave, onOpenChange]);

  const canSave =
    (selectedType === "emoji" && selectedEmoji) ||
    (selectedType === "generated" && selectedAvatarConfig);

  // Preview the currently selected icon
  const previewIconType = selectedType;
  const previewIconData =
    selectedType === "emoji" ? selectedEmoji : selectedAvatarConfig;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-4">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-3">
            {/* Preview */}
            <AppIcon
              appId={appId}
              appName={appName}
              iconType={previewIconType}
              iconData={previewIconData}
              size={40}
            />
            <span>Choose an icon</span>
          </DialogTitle>
        </DialogHeader>

        <Tabs
          defaultValue={currentIconType === "emoji" ? "emoji" : "avatar"}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="emoji">Emoji</TabsTrigger>
            <TabsTrigger value="avatar">Generated</TabsTrigger>
          </TabsList>

          <TabsContent value="emoji" className="mt-4">
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <EmojiPicker
                onEmojiSelect={handleEmojiSelect}
                theme={isDarkMode ? "dark" : "light"}
                previewPosition="none"
                skinTonePosition="search"
                maxFrequentRows={2}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="avatar" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Select a generated avatar
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRegenerateAvatars}
                  className="gap-1"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {avatarOptions.map((option, index) => {
                  const isSelected = selectedAvatarConfig === option.config;
                  return (
                    <button
                      key={`${option.seed}-${index}`}
                      type="button"
                      onClick={() => handleAvatarSelect(option.config)}
                      className={`flex items-center justify-center p-2 rounded-lg border-2 transition-all ${
                        isSelected
                          ? "border-primary ring-2 ring-primary/30"
                          : "border-transparent hover:border-muted-foreground/30"
                      }`}
                    >
                      <AvatarPreview
                        config={option.config}
                        size={48}
                        isDarkMode={isDarkMode}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Helper component to render avatar preview
function AvatarPreview({
  config,
  size,
  isDarkMode,
}: {
  config: string;
  size: number;
  isDarkMode: boolean;
}) {
  const { foregroundColor, backgroundColor, darkBackgroundColor, pattern } =
    useMemo(() => {
      try {
        const parsed = JSON.parse(config);
        return getAvatarProperties(parsed.seed);
      } catch {
        return getAvatarProperties("fallback");
      }
    }, [config]);

  const bgColor = isDarkMode ? darkBackgroundColor : backgroundColor;
  const cellSize = size / 5;
  const borderRadius = size * 0.15;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      aria-hidden="true"
    >
      <rect width={size} height={size} fill={bgColor} rx={borderRadius} />
      {pattern.map((row, rowIndex) =>
        row.map((cell, colIndex) =>
          cell === 1 ? (
            <rect
              key={`${rowIndex}-${colIndex}`}
              x={colIndex * cellSize}
              y={rowIndex * cellSize}
              width={cellSize}
              height={cellSize}
              fill={foregroundColor}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
