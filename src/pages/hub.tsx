import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useSettings } from "@/hooks/useSettings";
import { useTemplates } from "@/hooks/useTemplates";
import { TemplateCard } from "@/components/TemplateCard";
import { CreateAppDialog } from "@/components/CreateAppDialog";
import { NeonConnector } from "@/components/NeonConnector";
import { AddUserTemplateDialog } from "@/components/AddUserTemplateDialog";
import type { Template } from "@/shared/templates";

const HubPage: React.FC = () => {
  const router = useRouter();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isAddTemplateDialogOpen, setIsAddTemplateDialogOpen] = useState(false);
  const { templates, isLoading, refetch } = useTemplates();
  const { settings, updateSettings } = useSettings();
  const selectedTemplateId = settings?.selectedTemplateId;

  const handleTemplateSelect = (templateId: string) => {
    updateSettings({ selectedTemplateId: templateId });
  };

  const handleCreateApp = () => {
    setIsCreateDialogOpen(true);
  };
  // Define a virtual template entry for "Import your own template"
  const importTemplate: Template = {
    id: "import-template",
    title: "Import your own template",
    description:
      "Bring an existing project into Dyad and use it like any other template.",
    // Simple placeholder banner image
    imageUrl:
      "https://dummyimage.com/800x350/1f2937/ffffff&text=Import+your+own+template",
    isOfficial: true,
  };

  // Separate templates into official and community
  const officialTemplates = templates?.filter((t) => t.isOfficial) || [];
  const communityTemplates =
    templates?.filter((template) => !template.isOfficial) || [];

  // Derive user templates list by matching settings.userTemplates ids
  const userTemplateIds = new Set((settings?.userTemplates || []).map((t) => t.id));
  const yourTemplates: Template[] = templates?.filter((t) => userTemplateIds.has(t.id)) || [];

  return (
    <div className="min-h-screen px-8 py-4">
      <div className="max-w-5xl mx-auto pb-12">
        <Button
          onClick={() => router.history.back()}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 mb-4 bg-(--background-lightest) py-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
        <header className="mb-8 text-left">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Pick your default template
          </h1>
          <p className="text-md text-gray-600 dark:text-gray-400">
            Choose a starting point for your new project.
            {isLoading && " Loading additional templates..."}
          </p>
        </header>

        {/* Official Templates Section */}
        {officialTemplates.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Official templates
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {officialTemplates.map((template) => (
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
        )}

        {/* Your Templates Section */}
        <section className="mb-12" aria-label="your-templates">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
            Your templates
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Import your own template card */}
            <TemplateCard
              key={importTemplate.id}
              template={importTemplate}
              isSelected={false}
              onSelect={() => setIsAddTemplateDialogOpen(true)}
              onCreateApp={handleCreateApp}
            />
            {/* User-added templates */}
            {yourTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                isSelected={template.id === selectedTemplateId}
                onSelect={handleTemplateSelect}
                onCreateApp={handleCreateApp}
                deletable
                onDelete={async (templateId) => {
                  const next = (settings?.userTemplates || []).filter((t) => t.id !== templateId);
                  await updateSettings({ userTemplates: next });
                  await refetch();
                }}
              />
            ))}
          </div>
        </section>

        {/* Community Templates Section */}
        {communityTemplates.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Community templates
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {communityTemplates.map((template) => (
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
        )}

        <BackendSection />
      </div>

      <CreateAppDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        template={templates.find((t) => t.id === settings?.selectedTemplateId)}
      />

      {/* Add user template dialog triggered by the virtual Import template card */}
      <AddUserTemplateDialog
        open={isAddTemplateDialogOpen}
        onOpenChange={setIsAddTemplateDialogOpen}
        onAdded={() => {
          // Refresh template list to include the newly added user template
          refetch();
        }}
      />
    </div>
  );
};

function BackendSection() {
  return (
    <div className="">
      <header className="mb-4 text-left">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Backend Services
        </h1>
        <p className="text-md text-gray-600 dark:text-gray-400">
          Connect to backend services for your projects.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6">
        <NeonConnector />
      </div>
    </div>
  );
}

export default HubPage;
