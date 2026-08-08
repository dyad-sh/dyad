import { useState } from "react";
import { useCustomThemes } from "@/hooks/useCustomThemes";
import { CustomThemeDialog } from "@/components/CustomThemeDialog";
import { Button } from "@/components/ui/button";
import { Plus, Palette } from "lucide-react";
import { LibraryCard } from "@/components/LibraryCard";

export default function ThemesPage() {
  const { customThemes, isLoading } = useCustomThemes();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="flex items-center text-2xl font-bold sm:text-3xl">
            <Palette className="mr-2 h-7 w-7 sm:h-8 sm:w-8" />
            Themes
          </h1>
          <Button
            className="w-full sm:w-auto"
            onClick={() => setCreateDialogOpen(true)}
          >
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {customThemes.map((theme) => (
              <LibraryCard
                key={theme.id}
                item={{ type: "theme", data: theme }}
              />
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
