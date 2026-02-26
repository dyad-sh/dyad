import React, { useState } from "react";
import { LayoutTemplate, ExternalLink } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { useTemplates } from "@/hooks/useTemplates";
import {
  useCustomTemplates,
  useCreateCustomTemplate,
  useUpdateCustomTemplate,
  useDeleteCustomTemplate,
} from "@/hooks/useCustomTemplates";
import { TemplateCard } from "@/components/TemplateCard";
import { CreateAppDialog } from "@/components/CreateAppDialog";
import { NeonConnector } from "@/components/NeonConnector";
import { CreateCustomTemplateDialog } from "@/components/CreateCustomTemplateDialog";
import { EditCustomTemplateDialog } from "@/components/EditCustomTemplateDialog";
import { DeleteConfirmationDialog } from "@/components/DeleteConfirmationDialog";
import { Button } from "@/components/ui/button";
import { showError } from "@/lib/toast";
import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";
import type { CustomTemplate } from "@/ipc/types";

const CUSTOM_TEMPLATE_PREFIX = "custom-template:";

export default function LibraryTemplatesPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreateTemplateDialogOpen, setIsCreateTemplateDialogOpen] =
    useState(false);
  const { templates } = useTemplates();
  const { customTemplates, isLoading: isCustomLoading } = useCustomTemplates();
  const createMutation = useCreateCustomTemplate();
  const { settings, updateSettings } = useSettings();
  const selectedTemplateId = settings?.selectedTemplateId;

  // Only show official (built-in) templates
  const builtInTemplates =
    templates?.filter((template) => template.isOfficial) || [];

  const handleTemplateSelect = (templateId: string) => {
    updateSettings({ selectedTemplateId: templateId });
  };

  const handleCreateApp = () => {
    setIsCreateDialogOpen(true);
  };

  const handleCreateCustomTemplate = async (params: {
    name: string;
    description?: string;
    githubUrl: string;
    imageUrl?: string;
  }) => {
    await createMutation.mutateAsync(params);
  };

  return (
    <div className="min-h-screen px-8 py-6">
      <div className="max-w-6xl mx-auto pb-12">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">
            <LayoutTemplate className="inline-block h-8 w-8 mr-2" />
            Templates
          </h1>
        </div>

        {/* Built-in Templates Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Built-in Templates</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {builtInTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isSelected={template.id === selectedTemplateId}
                onSelect={handleTemplateSelect}
                onCreateApp={handleCreateApp}
              />
            ))}
          </div>
        </section>

        {/* Integrations Section */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold mb-6">Integrations</h2>
          <div className="grid grid-cols-1 gap-6">
            <NeonConnector />
          </div>
        </section>

        {/* My Templates Section */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">My Templates</h2>
            <CreateCustomTemplateDialog
              open={isCreateTemplateDialogOpen}
              onOpenChange={setIsCreateTemplateDialogOpen}
              onCreateTemplate={handleCreateCustomTemplate}
            />
          </div>
          {isCustomLoading ? (
            <div>Loading...</div>
          ) : customTemplates.length === 0 ? (
            <div className="text-muted-foreground">
              No custom templates yet. Create one to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {customTemplates.map((ct) => (
                <CustomTemplateCard
                  key={ct.id}
                  customTemplate={ct}
                  isSelected={
                    selectedTemplateId === `${CUSTOM_TEMPLATE_PREFIX}${ct.id}`
                  }
                  onSelect={() =>
                    handleTemplateSelect(`${CUSTOM_TEMPLATE_PREFIX}${ct.id}`)
                  }
                  onCreateApp={handleCreateApp}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <CreateAppDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        template={
          // Try to find in built-in templates or construct from custom templates
          templates?.find((t) => t.id === settings?.selectedTemplateId) ??
          (() => {
            if (
              settings?.selectedTemplateId?.startsWith(CUSTOM_TEMPLATE_PREFIX)
            ) {
              const numericId = Number(
                settings.selectedTemplateId.slice(
                  CUSTOM_TEMPLATE_PREFIX.length,
                ),
              );
              const ct = customTemplates.find((c) => c.id === numericId);
              if (ct) {
                return {
                  id: `${CUSTOM_TEMPLATE_PREFIX}${ct.id}`,
                  title: ct.name,
                  description: ct.description || "",
                  imageUrl: ct.imageUrl || "",
                  githubUrl: ct.githubUrl,
                  isOfficial: false,
                };
              }
            }
            return undefined;
          })()
        }
      />
    </div>
  );
}

function CustomTemplateCard({
  customTemplate,
  isSelected,
  onSelect,
  onCreateApp,
}: {
  customTemplate: CustomTemplate;
  isSelected: boolean;
  onSelect: () => void;
  onCreateApp: () => void;
}) {
  const updateMutation = useUpdateCustomTemplate();
  const deleteMutation = useDeleteCustomTemplate();

  const handleUpdate = async (params: {
    id: number;
    name?: string;
    description?: string;
    githubUrl?: string;
    imageUrl?: string;
  }) => {
    await updateMutation.mutateAsync(params);
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(customTemplate.id);
    } catch (error) {
      showError(
        `Failed to delete template: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const handleGithubClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    ipc.system.openExternalUrl(customTemplate.githubUrl);
  };

  return (
    <div
      onClick={onSelect}
      className={`
        bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden
        transform transition-all duration-300 ease-in-out
        cursor-pointer group relative
        ${
          isSelected
            ? "ring-2 ring-blue-500 dark:ring-blue-400 shadow-xl"
            : "hover:shadow-lg hover:-translate-y-1"
        }
      `}
    >
      {customTemplate.imageUrl && (
        <div className="relative">
          <img
            src={customTemplate.imageUrl}
            alt={customTemplate.name}
            className={`w-full h-52 object-cover transition-opacity duration-300 group-hover:opacity-80 ${
              isSelected ? "opacity-75" : ""
            }`}
          />
          {isSelected && (
            <span className="absolute top-3 right-3 bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-lg">
              Selected
            </span>
          )}
        </div>
      )}
      {!customTemplate.imageUrl && isSelected && (
        <div className="relative h-8">
          <span className="absolute top-3 right-3 bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-lg">
            Selected
          </span>
        </div>
      )}
      <div className="p-4">
        <div className="flex justify-between items-center mb-1.5">
          <h2
            className={`text-lg font-semibold ${
              isSelected
                ? "text-blue-600 dark:text-blue-400"
                : "text-gray-900 dark:text-white"
            }`}
          >
            {customTemplate.name}
          </h2>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <EditCustomTemplateDialog
              template={customTemplate}
              onUpdateTemplate={handleUpdate}
            />
            <DeleteConfirmationDialog
              itemName={customTemplate.name}
              itemType="Template"
              onDelete={handleDelete}
              isDeleting={deleteMutation.isPending}
            />
          </div>
        </div>
        {customTemplate.description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3 h-10 overflow-y-auto">
            {customTemplate.description}
          </p>
        )}
        <a
          className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors duration-200"
          onClick={handleGithubClick}
        >
          View on GitHub <ExternalLink className="w-4 h-4 ml-1" />
        </a>

        <Button
          onClick={(e) => {
            e.stopPropagation();
            onCreateApp();
          }}
          size="sm"
          className={cn(
            "w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold mt-2",
            !isSelected && "invisible",
          )}
        >
          Create App
        </Button>
      </div>
    </div>
  );
}
