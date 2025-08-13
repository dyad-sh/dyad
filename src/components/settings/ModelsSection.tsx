import { useState } from "react";
import { AlertTriangle, PlusIcon, TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CreateCustomModelDialog } from "@/components/CreateCustomModelDialog";
import { EditCustomModelDialog } from "@/components/EditCustomModelDialog";
import { useLanguageModelsForProvider } from "@/hooks/useLanguageModelsForProvider"; // Use the hook directly here
import { useDeleteCustomModel } from "@/hooks/useDeleteCustomModel"; // Import the new hook
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ModelsSectionProps {
  providerId: string;
}

export function ModelsSection({ providerId }: ModelsSectionProps) {
  const [isCustomModelDialogOpen, setIsCustomModelDialogOpen] = useState(false);
  const [isEditModelDialogOpen, setIsEditModelDialogOpen] = useState(false);
  const [isConfirmDeleteDialogOpen, setIsConfirmDeleteDialogOpen] =
    useState(false);
  const [modelToDelete, setModelToDelete] = useState<string | null>(null);
  const [modelToEdit, setModelToEdit] = useState<any | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Fetch custom models within this component now
  const {
    data: models,
    isLoading: modelsLoading,
    error: modelsError,
    refetch: refetchModels,
  } = useLanguageModelsForProvider(providerId);

  const { mutate: deleteModel, isPending: isDeleting } = useDeleteCustomModel({
    onSuccess: () => {
      refetchModels(); // Refetch models list after successful deletion
      // Optionally show a success toast here
    },
    onError: (error: Error) => {
      // Optionally show an error toast here
      console.error("Failed to delete model:", error);
    },
  });

  const handleDeleteClick = (modelApiName: string) => {
    setModelToDelete(modelApiName);
    setIsConfirmDeleteDialogOpen(true);
  };

  const handleEditClick = (model: any) => {
    setModelToEdit(model);
    setIsEditModelDialogOpen(true);
  };

  const handleModelClick = (modelApiName: string) => {
    setSelectedModel(selectedModel === modelApiName ? null : modelApiName);
  };

  const handleModelDoubleClick = (model: any) => {
    if (model.type === "custom") {
      handleEditClick(model);
    }
  };

  const handleConfirmDelete = () => {
    if (modelToDelete) {
      deleteModel({ providerId, modelApiName: modelToDelete });
      setModelToDelete(null);
    }
    setIsConfirmDeleteDialogOpen(false);
  };

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
              key={model.apiName + model.displayName}
              className={`p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm cursor-pointer hover:shadow-md transition-shadow ${
                selectedModel === model.apiName
                  ? "ring-2 ring-blue-500 dark:ring-blue-400"
                  : ""
              }`}
              onClick={() => handleModelClick(model.apiName)}
              onDoubleClick={() => handleModelDoubleClick(model)}
            >
              <div className="flex justify-between items-center">
                <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                  {model.displayName}
                </h4>
                {model.type === "custom" && (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditClick(model);
                      }}
                      className="text-blue-500 hover:text-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/50 h-8 w-8"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteClick(model.apiName);
                      }}
                      disabled={isDeleting}
                      className="text-red-500 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/50 h-8 w-8"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                {model.apiName}
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
              <div className="flex flex-wrap gap-x-2">
                <span className="mt-2 inline-block bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full dark:bg-blue-900 dark:text-blue-300">
                  {model.type === "cloud" ? "Built-in" : "Custom"}
                </span>

                {model.tag && (
                  <span className="mt-2 inline-block bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full dark:bg-blue-900 dark:text-blue-300">
                    {model.tag}
                  </span>
                )}
              </div>
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

      {providerId !== "auto" && (
        <Button
          onClick={() => setIsCustomModelDialogOpen(true)}
          variant="outline"
          className="mt-6"
        >
          <PlusIcon className="mr-2 h-4 w-4" /> Add Custom Model
        </Button>
      )}

      {/* Render the dialogs */}
      <CreateCustomModelDialog
        isOpen={isCustomModelDialogOpen}
        onClose={() => setIsCustomModelDialogOpen(false)}
        onSuccess={() => {
          setIsCustomModelDialogOpen(false);
          refetchModels(); // Refetch models on success
        }}
        providerId={providerId}
      />

      <EditCustomModelDialog
        isOpen={isEditModelDialogOpen}
        onClose={() => setIsEditModelDialogOpen(false)}
        onSuccess={() => {
          setIsEditModelDialogOpen(false);
          refetchModels(); // Refetch models on success
        }}
        providerId={providerId}
        model={modelToEdit}
      />

      <AlertDialog
        open={isConfirmDeleteDialogOpen}
        onOpenChange={setIsConfirmDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Are you sure you want to delete this model?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              custom model "
              {modelToDelete
                ? models?.find((m) => m.apiName === modelToDelete)
                    ?.displayName || modelToDelete
                : ""}
              " (API Name: {modelToDelete}).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setModelToDelete(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? "Deleting..." : "Yes, delete it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
