import { useState } from "react";
import { AlertTriangle, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CreateCustomModelDialog } from "@/components/CreateCustomModelDialog";
import { useLanguageModelsForProvider } from "@/hooks/useLanguageModelsForProvider"; // Use the hook directly here

interface ModelsSectionProps {
  providerId: string;
}

export function ModelsSection({ providerId }: ModelsSectionProps) {
  const [isCustomModelDialogOpen, setIsCustomModelDialogOpen] = useState(false);

  // Fetch custom models within this component now
  const {
    data: models,
    isLoading: modelsLoading,
    error: modelsError,
    refetch: refetchModels,
  } = useLanguageModelsForProvider(providerId);

  return (
    <div className="mt-8 border-t pt-6">
      <h2 className="text-2xl font-semibold mb-4">Models</h2>
      <p className="text-muted-foreground mb-4">
        Manage specific models available through this provider.
      </p>

      {/* Custom Models List Area */}
      {modelsLoading && (
        <div className="space-y-3 mt-4">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      )}
      {modelsError && (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error Loading Models</AlertTitle>
          <AlertDescription>{modelsError.message}</AlertDescription>
        </Alert>
      )}
      {!modelsLoading && !modelsError && models && models.length > 0 && (
        <div className="mt-4 space-y-3">
          {models.map((model) => (
            <div
              key={model.name}
              className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm"
            >
              <div className="flex justify-between items-center">
                <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                  {model.displayName}
                </h4>
                {/* Optional: Add an edit/delete button here later */}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                {model.name}
              </p>
              {model.description && (
                <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  {model.description}
                </p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
                {model.contextWindow && (
                  <span>
                    Context: {model.contextWindow.toLocaleString()} tokens
                  </span>
                )}
                {model.maxOutputTokens && (
                  <span>
                    Max Output: {model.maxOutputTokens.toLocaleString()} tokens
                  </span>
                )}
              </div>
              {model.tag && (
                <span className="mt-2 inline-block bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full dark:bg-blue-900 dark:text-blue-300">
                  {model.tag}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {!modelsLoading && !modelsError && (!models || models.length === 0) && (
        <p className="text-muted-foreground mt-4">
          No custom models have been added for this provider yet.
        </p>
      )}
      {/* End Custom Models List Area */}

      <Button
        onClick={() => setIsCustomModelDialogOpen(true)}
        variant="outline"
        className="mt-6"
      >
        <PlusIcon className="mr-2 h-4 w-4" /> Add Custom Model
      </Button>

      {/* Render the dialog */}
      <CreateCustomModelDialog
        isOpen={isCustomModelDialogOpen}
        onClose={() => setIsCustomModelDialogOpen(false)}
        onSuccess={() => {
          setIsCustomModelDialogOpen(false);
          refetchModels(); // Refetch models on success
        }}
        providerId={providerId}
      />
    </div>
  );
}
