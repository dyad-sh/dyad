import { useEffect, useMemo, useState, type ComponentType } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppIcon } from "@/components/ui/AppIcon";
import {
  createGeneratedIconDataForApp,
  parseGeneratedIconData,
  type AppIconType,
} from "@/lib/appIcons";

const LAST_TAB_STORAGE_KEY = "dyad:icon-picker:last-tab";
const RECENT_EMOJI_STORAGE_KEY = "dyad:icon-picker:recent-emojis";
const MAX_RECENT_EMOJIS = 16;

type PickerEmojiPayload = {
  native?: string;
};

type IconPickerModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: number;
  appName: string;
  currentIconType: string | null;
  currentIconData: string | null;
  onSave: (payload: {
    iconType: AppIconType;
    iconData: string;
  }) => Promise<void>;
  isSaving: boolean;
};

export function IconPickerModal({
  open,
  onOpenChange,
  appId,
  appName,
  currentIconType,
  currentIconData,
  onSave,
  isSaving,
}: IconPickerModalProps) {
  const [activeTab, setActiveTab] = useState<"emoji" | "avatar">("emoji");
  const [workingGeneratedIconData, setWorkingGeneratedIconData] = useState("");
  const [emojiPickerComponent, setEmojiPickerComponent] =
    useState<ComponentType<any> | null>(null);
  const [emojiData, setEmojiData] = useState<any>(null);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);

  useEffect(() => {
    const storedTab = window.localStorage.getItem(LAST_TAB_STORAGE_KEY);
    if (storedTab === "emoji" || storedTab === "avatar") {
      setActiveTab(storedTab);
    }

    const storedRecent = window.localStorage.getItem(RECENT_EMOJI_STORAGE_KEY);
    if (!storedRecent) {
      return;
    }

    try {
      const parsedRecent = JSON.parse(storedRecent);
      if (Array.isArray(parsedRecent)) {
        setRecentEmojis(
          parsedRecent.filter((value) => typeof value === "string"),
        );
      }
    } catch {
      // Ignore invalid localStorage payload.
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    const parsedCurrent = parseGeneratedIconData(
      currentIconType,
      currentIconData,
    );
    setWorkingGeneratedIconData(
      parsedCurrent
        ? JSON.stringify(parsedCurrent)
        : createGeneratedIconDataForApp(appId, appName),
    );
  }, [open, appId, appName, currentIconType, currentIconData]);

  useEffect(() => {
    if (!open || activeTab !== "emoji" || (emojiPickerComponent && emojiData)) {
      return;
    }

    void Promise.all([
      import("@emoji-mart/react"),
      import("@emoji-mart/data"),
    ]).then(([pickerModule, dataModule]) => {
      setEmojiPickerComponent(() => pickerModule.default);
      setEmojiData(dataModule.default);
    });
  }, [open, activeTab, emojiPickerComponent, emojiData]);

  const generatedPreviewData = useMemo(() => {
    const parsed = parseGeneratedIconData(
      "generated",
      workingGeneratedIconData,
    );
    if (parsed) {
      return JSON.stringify(parsed);
    }
    return createGeneratedIconDataForApp(appId, appName);
  }, [workingGeneratedIconData, appId, appName]);
  const EmojiPicker = emojiPickerComponent;

  const persistRecentEmojis = (nextRecent: string[]) => {
    setRecentEmojis(nextRecent);
    window.localStorage.setItem(
      RECENT_EMOJI_STORAGE_KEY,
      JSON.stringify(nextRecent),
    );
  };

  const handleSaveEmoji = async (emoji: string) => {
    const nextRecent = [
      emoji,
      ...recentEmojis.filter((value) => value !== emoji),
    ].slice(0, MAX_RECENT_EMOJIS);
    persistRecentEmojis(nextRecent);

    await onSave({
      iconType: "emoji",
      iconData: emoji,
    });
    onOpenChange(false);
  };

  const handleRegenerate = () => {
    setWorkingGeneratedIconData(
      createGeneratedIconDataForApp(appId, appName, String(Date.now())),
    );
  };

  const handleApplyGenerated = async () => {
    await onSave({
      iconType: "generated",
      iconData: generatedPreviewData,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose app icon</DialogTitle>
        </DialogHeader>
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            const nextValue = value === "avatar" ? "avatar" : "emoji";
            setActiveTab(nextValue);
            window.localStorage.setItem(LAST_TAB_STORAGE_KEY, nextValue);
          }}
        >
          <TabsList>
            <TabsTrigger value="emoji">Emoji</TabsTrigger>
            <TabsTrigger value="avatar">Avatar</TabsTrigger>
          </TabsList>
          <TabsContent value="emoji">
            {recentEmojis.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="text-xs text-muted-foreground">Recent</div>
                {recentEmojis.map((emoji) => (
                  <Button
                    key={`${emoji}-recent`}
                    variant="outline"
                    className="h-9 w-9 p-0 text-lg"
                    onClick={() => {
                      void handleSaveEmoji(emoji);
                    }}
                    disabled={isSaving}
                  >
                    {emoji}
                  </Button>
                ))}
              </div>
            )}
            <div className="max-h-[430px] overflow-auto rounded-md border">
              {EmojiPicker && emojiData ? (
                <EmojiPicker
                  data={emojiData}
                  onEmojiSelect={(emoji: PickerEmojiPayload) => {
                    if (!emoji.native) return;
                    void handleSaveEmoji(emoji.native);
                  }}
                  previewPosition="none"
                  skinTonePosition="none"
                  autoFocus
                />
              ) : (
                <div className="p-6 text-sm text-muted-foreground">
                  Loading emoji picker...
                </div>
              )}
            </div>
          </TabsContent>
          <TabsContent value="avatar">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 rounded-md border p-4">
                <div className="flex flex-col items-center gap-3 rounded-md border bg-white p-4">
                  <span className="text-xs text-muted-foreground">Light</span>
                  <AppIcon
                    appId={appId}
                    appName={appName}
                    iconType="generated"
                    iconData={generatedPreviewData}
                    size={128}
                  />
                </div>
                <div className="flex flex-col items-center gap-3 rounded-md border bg-gray-900 p-4">
                  <span className="text-xs text-gray-300">Dark</span>
                  <AppIcon
                    appId={appId}
                    appName={appName}
                    iconType="generated"
                    iconData={generatedPreviewData}
                    size={128}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={handleRegenerate}
                  disabled={isSaving}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Regenerate
                </Button>
                <Button
                  onClick={() => void handleApplyGenerated()}
                  disabled={isSaving}
                >
                  Apply
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
