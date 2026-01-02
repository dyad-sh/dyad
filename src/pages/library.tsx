import React, { useState, useEffect } from "react";
import { usePrompts } from "@/hooks/usePrompts";
import {
  CreatePromptDialog,
  CreateOrEditPromptDialog,
} from "@/components/CreatePromptDialog";
import { DeleteConfirmationDialog } from "@/components/DeleteConfirmationDialog";
import { useDeepLink } from "@/contexts/DeepLinkContext";
import { AddPromptDeepLinkData } from "@/ipc/deep_link_data";
import { showInfo } from "@/lib/toast";
import { BookOpen, Sparkles } from "lucide-react";

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
        const deepLink = lastDeepLink as AddPromptDeepLinkData;
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
      // Clear prefill data when dialog closes
      setPrefillData(undefined);
    }
  };

  return (
    <div className="min-h-screen px-8 py-6">
      <div className="max-w-6xl mx-auto">
        {/* Enhanced Header */}
        <div className="flex items-center justify-between mb-8 p-6 rounded-2xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-rose-500/10 border border-amber-500/20">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500/20 via-orange-500/20 to-rose-500/20 border border-amber-500/20">
              <BookOpen className="h-7 w-7 text-amber-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-600 via-orange-600 to-rose-600 bg-clip-text text-transparent">
                Library: Prompts
              </h1>
              <p className="text-muted-foreground text-sm">
                Manage your saved prompts and templates
              </p>
            </div>
          </div>
          <CreatePromptDialog
            onCreatePrompt={createPrompt}
            prefillData={prefillData}
            isOpen={dialogOpen}
            onOpenChange={handleDialogClose}
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Sparkles className="h-5 w-5 animate-pulse text-amber-500" />
              <span>Loading prompts...</span>
            </div>
          </div>
        ) : prompts.length === 0 ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/10 via-orange-500/10 to-rose-500/10 border border-amber-500/20 mb-4">
              <BookOpen className="h-8 w-8 text-amber-500/60" />
            </div>
            <p className="text-muted-foreground">
              No prompts yet. Create one to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {prompts.map((p) => (
              <PromptCard
                key={p.id}
                prompt={p}
                onUpdate={updatePrompt}
                onDelete={deletePrompt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PromptCard({
  prompt,
  onUpdate,
  onDelete,
}: {
  prompt: {
    id: number;
    title: string;
    description: string | null;
    content: string;
  };
  onUpdate: (p: {
    id: number;
    title: string;
    description?: string;
    content: string;
  }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  return (
    <div
      data-testid="prompt-card"
      className="group relative overflow-hidden border border-border/50 rounded-xl p-4 
        bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-rose-500/5
        hover:from-amber-500/10 hover:via-orange-500/10 hover:to-rose-500/10
        hover:border-amber-500/30 hover:shadow-lg hover:shadow-amber-500/5
        transition-all duration-300 min-w-80"
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground group-hover:text-amber-600 transition-colors">
              {prompt.title}
            </h3>
            {prompt.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {prompt.description}
              </p>
            )}
          </div>
          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <CreateOrEditPromptDialog
              mode="edit"
              prompt={prompt}
              onUpdatePrompt={onUpdate}
            />
            <DeleteConfirmationDialog
              itemName={prompt.title}
              itemType="Prompt"
              onDelete={() => onDelete(prompt.id)}
            />
          </div>
        </div>
        <pre className="text-sm whitespace-pre-wrap bg-background/50 border border-border/50 rounded-lg p-3 max-h-48 overflow-auto backdrop-blur-sm">
          {prompt.content}
        </pre>
      </div>
    </div>
  );
}
