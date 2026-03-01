import { useState, useEffect } from "react";
import { usePrompts } from "@/hooks/usePrompts";
import { CreatePromptDialog } from "@/components/CreatePromptDialog";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { AddPromptDeepLinkData } from "@/ipc/deep_link_data";
import { showInfo } from "@/lib/toast";
import { LibraryCard } from "@/components/LibraryCard";

export default function LibraryPage() {
  const { prompts, isLoading, createPrompt, updatePrompt, deletePrompt } =
    usePrompts();
  const { lastDeepLink, clearLastDeepLink } = useDeepLink();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prefillData, setPrefillData] = useState<
    | {
        title: string;
        description: string;
        content: string;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    const handleDeepLink = async () => {
      if (lastDeepLink?.type === "add-prompt") {
        const deepLink = lastDeepLink as unknown as AddPromptDeepLinkData;
        const payload = deepLink.payload;
        showInfo(`Prefilled prompt: ${payload.title}`);
        setPrefillData({
          title: payload.title,
          description: payload.description,
          content: payload.content,
        });
        setDialogOpen(true);
        clearLastDeepLink();
      }
    };
    handleDeepLink();
  }, [lastDeepLink?.timestamp, clearLastDeepLink]);

  const handleDialogClose = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setPrefillData(undefined);
    }
  };

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold sm:text-3xl">Library: Prompts</h1>
          <div className="shrink-0">
            <CreatePromptDialog
              onCreatePrompt={createPrompt}
              prefillData={prefillData}
              isOpen={dialogOpen}
              onOpenChange={handleDialogClose}
            />
          </div>
        </div>

        {isLoading ? (
          <div>Loading...</div>
        ) : prompts.length === 0 ? (
          <div className="text-muted-foreground">
            No prompts yet. Create one to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {prompts.map((p) => (
              <LibraryCard
                key={p.id}
                item={{ type: "prompt", data: p }}
                onUpdatePrompt={updatePrompt}
                onDeletePrompt={deletePrompt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
