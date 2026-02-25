import {
  useUpdateCustomTheme,
  useDeleteCustomTheme,
} from "@/hooks/useCustomThemes";
import type { PromptItem } from "@/hooks/usePrompts";
import { Badge } from "@/components/ui/badge";
import { Palette, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateOrEditPromptDialog } from "@/components/CreatePromptDialog";
import { DeleteConfirmationDialog } from "@/components/DeleteConfirmationDialog";
import { EditThemeDialog } from "@/components/EditThemeDialog";
import { showError } from "@/lib/toast";
import type { CustomTheme } from "@/ipc/types";

export type LibraryItem =
  | { type: "theme"; data: CustomTheme }
  | { type: "prompt"; data: PromptItem };

const CARD_TYPE_CONFIG = {
  theme: {
    icon: Palette,
    label: "Theme",
    badgeClass:
      "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-800",
  },
  prompt: {
    icon: FileText,
    label: "Prompt",
    badgeClass:
      "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800",
  },
} as const;

export function LibraryCard({
  item,
  onUpdatePrompt,
  onDeletePrompt,
}: {
  item: LibraryItem;
  onUpdatePrompt?: (p: {
    id: number;
    title: string;
    description?: string;
    content: string;
  }) => Promise<void>;
  onDeletePrompt?: (id: number) => Promise<void>;
}) {
  const config = CARD_TYPE_CONFIG[item.type];
  const Icon = config.icon;

  const title = item.type === "theme" ? item.data.name : item.data.title;
  const description = item.data.description;
  const content = item.type === "theme" ? item.data.prompt : item.data.content;

  return (
    <div
      data-testid={`library-${item.type}-card`}
      className="border rounded-lg p-4 bg-(--background-lightest) relative"
    >
      <Badge
        variant="outline"
        className={cn("absolute top-3 right-3 gap-1", config.badgeClass)}
      >
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
      <div className="space-y-2">
        <div className="flex items-start justify-between pr-20">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <h3 className="text-lg font-semibold truncate">{title}</h3>
            </div>
            {description && (
              <p className="text-sm text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </div>
        </div>
        <pre className="text-sm whitespace-pre-wrap bg-transparent border rounded p-2 max-h-48 overflow-auto">
          {content}
        </pre>
        <div className="flex gap-1 justify-end">
          {item.type === "theme" ? (
            <ThemeActions theme={item.data} />
          ) : (
            onUpdatePrompt &&
            onDeletePrompt && (
              <PromptActions
                prompt={item.data}
                onUpdate={onUpdatePrompt}
                onDelete={onDeletePrompt}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ThemeActions({ theme }: { theme: CustomTheme }) {
  const updateThemeMutation = useUpdateCustomTheme();
  const deleteThemeMutation = useDeleteCustomTheme();
  const isDeleting = deleteThemeMutation.isPending;

  const handleUpdate = async (params: {
    id: number;
    name: string;
    description?: string;
    prompt: string;
  }) => {
    await updateThemeMutation.mutateAsync(params);
  };

  const handleDelete = async () => {
    try {
      await deleteThemeMutation.mutateAsync(theme.id);
    } catch (error) {
      showError(
        `Failed to delete theme: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  return (
    <>
      <EditThemeDialog theme={theme} onUpdateTheme={handleUpdate} />
      <DeleteConfirmationDialog
        itemName={theme.name}
        itemType="Theme"
        onDelete={handleDelete}
        isDeleting={isDeleting}
      />
    </>
  );
}

function PromptActions({
  prompt,
  onUpdate,
  onDelete,
}: {
  prompt: PromptItem;
  onUpdate: (p: {
    id: number;
    title: string;
    description?: string;
    content: string;
  }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  return (
    <>
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
    </>
  );
}
