import { useState } from "react";
import {
  useCustomThemes,
  useUpdateCustomTheme,
  useDeleteCustomTheme,
} from "@/hooks/useCustomThemes";
import { CustomThemeDialog } from "@/components/CustomThemeDialog";
import { EditThemeDialog } from "@/components/EditThemeDialog";
import { DeleteConfirmationDialog } from "@/components/DeleteConfirmationDialog";
import { Button } from "@/components/ui/button";
import { Plus, Palette } from "lucide-react";
import { showError } from "@/lib/toast";
import type { CustomTheme } from "@/ipc/types";

export default function ThemesPage() {
  const { customThemes, isLoading } = useCustomThemes();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  return (
    <div className="min-h-screen px-8 py-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold mr-4">
            <Palette className="inline-block h-8 w-8 mr-2" />
            Themes
          </h1>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Theme
          </Button>
        </div>

        {isLoading ? (
          <div>Loading...</div>
        ) : customThemes.length === 0 ? (
          <div className="text-muted-foreground">
            No custom themes yet. Create one to get started.
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {customThemes.map((theme) => (
              <ThemeCard key={theme.id} theme={theme} />
            ))}
          </div>
        )}

        <CustomThemeDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
        />
      </div>
    </div>
  );
}

function ThemeCard({ theme }: { theme: CustomTheme }) {
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
    <div
      data-testid="theme-card"
      className="border rounded-lg p-4 bg-(--background-lightest)"
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-muted-foreground shrink-0" />
              <h3 className="text-lg font-semibold truncate">{theme.name}</h3>
            </div>
            {theme.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {theme.description}
              </p>
            )}
          </div>
          <div className="flex gap-1 shrink-0 ml-2">
            <EditThemeDialog theme={theme} onUpdateTheme={handleUpdate} />
            <DeleteConfirmationDialog
              itemName={theme.name}
              itemType="Theme"
              onDelete={handleDelete}
              isDeleting={isDeleting}
            />
          </div>
        </div>
        <pre className="text-sm whitespace-pre-wrap bg-transparent border rounded p-2 max-h-48 overflow-auto">
          {theme.prompt}
        </pre>
      </div>
    </div>
  );
}
