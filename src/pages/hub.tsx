import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Layout, Sparkles, Users } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useSettings } from "@/hooks/useSettings";
import { useTemplates } from "@/hooks/useTemplates";
import { TemplateCard } from "@/components/TemplateCard";
import { CreateAppDialog } from "@/components/CreateAppDialog";
import { NeonConnector } from "@/components/NeonConnector";

const HubPage: React.FC = () => {
  const router = useRouter();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const { templates, isLoading } = useTemplates();
  const { settings, updateSettings } = useSettings();
  const selectedTemplateId = settings?.selectedTemplateId;

  const handleTemplateSelect = (templateId: string) => {
    updateSettings({ selectedTemplateId: templateId });
  };

  const handleCreateApp = () => {
    setIsCreateDialogOpen(true);
  };
  // Separate templates into official and community
  const officialTemplates =
    templates?.filter((template) => template.isOfficial) || [];
  const communityTemplates =
    templates?.filter((template) => !template.isOfficial) || [];

  return (
    <div className="min-h-screen px-8 py-6">
      <div className="max-w-5xl mx-auto pb-12">
        <Button
          onClick={() => router.history.back()}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 mb-6 border-border/50 hover:border-cyan-500/30 hover:bg-cyan-500/10 transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
        
        {/* Enhanced Header */}
        <header className="mb-10 p-6 rounded-2xl bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-indigo-500/10 border border-cyan-500/20">
          <div className="flex items-center gap-4 mb-3">
            <div className="p-3 rounded-xl bg-gradient-to-br from-cyan-500/20 via-blue-500/20 to-indigo-500/20 border border-cyan-500/20">
              <Layout className="h-7 w-7 text-cyan-500" />
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Pick your default template
            </h1>
          </div>
          <p className="text-muted-foreground ml-16">
            Choose a starting point for your new project.
            {isLoading && (
              <span className="inline-flex items-center gap-2 ml-2 text-cyan-500">
                <Sparkles className="h-4 w-4 animate-pulse" />
                Loading additional templates...
              </span>
            )}
          </p>
        </header>

        {/* Official Templates Section */}
        {officialTemplates.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20">
                <Sparkles className="h-5 w-5 text-cyan-500" />
              </div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
                Official templates
              </h2>
            </div>
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

        {/* Community Templates Section */}
        {communityTemplates.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-purple-500/20 border border-violet-500/20">
                <Users className="h-5 w-5 text-violet-500" />
              </div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                Community templates
              </h2>
            </div>
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
        template={templates?.find((t) => t.id === settings?.selectedTemplateId)}
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
