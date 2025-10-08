import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useSettings } from "@/hooks/useSettings";
import { useTemplates } from "@/hooks/useTemplates";
import { TemplateCard } from "@/components/TemplateCard";
import { CreateAppDialog } from "@/components/CreateAppDialog";
import { NeonConnector } from "@/components/NeonConnector";
import { contractTranslationTemplates } from "@/shared/templates";
import { homeModeAtom } from "@/atoms/appAtoms";
import { useAtom } from "jotai";

const HubPage: React.FC = () => {
  const router = useRouter();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const { templates, isLoading } = useTemplates();
  const { settings, updateSettings } = useSettings();
  const selectedTemplateId = settings?.selectedTemplateId;
  const [mode] = useAtom(homeModeAtom);

  const handleTemplateSelect = (templateId: string) => {
    updateSettings({ selectedTemplateId: templateId });
  };

  const handleCreateApp = () => {
    setIsCreateDialogOpen(true);
  };

  // Combine regular templates with contract translation templates
  const allTemplates = [...templates, ...contractTranslationTemplates];
  // Separate templates into official and community
  const officialTemplates =
    templates?.filter((template) => template.isOfficial) || [];
  const communityTemplates =
    templates?.filter((template) => !template.isOfficial) || [];

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

        {mode === "translate" ? (
          // Translate Mode - Show Contract Templates
          <>
            <header className="mb-8 text-left">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                Translate Solidity to Sui Move
              </h1>
              <p className="text-md text-gray-600 dark:text-gray-400">
                Select a standard ERC contract to translate to Sui Move
              </p>
            </header>

            <SmartContractSection
              selectedTemplateId={selectedTemplateId}
              onSelect={handleTemplateSelect}
              onCreateApp={handleCreateApp}
            />
          </>
        ) : (
          // Generate Mode - Show Regular Templates
          <>
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
          </>
        )}
      </div>

      <CreateAppDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        template={allTemplates.find((t) => t.id === settings?.selectedTemplateId)}
      />
    </div>
  );
};

interface SmartContractSectionProps {
  selectedTemplateId: string | undefined;
  onSelect: (templateId: string) => void;
  onCreateApp: () => void;
}

function SmartContractSection({
  selectedTemplateId,
  onSelect,
  onCreateApp,
}: SmartContractSectionProps) {
  return (
    <section className="mb-12">
      <header className="mb-6 text-left">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Standard ERC Contracts
        </h2>
        <p className="text-md text-gray-600 dark:text-gray-400">
          One-click translation from OpenZeppelin implementations
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {contractTranslationTemplates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            isSelected={template.id === selectedTemplateId}
            onSelect={onSelect}
            onCreateApp={onCreateApp}
          />
        ))}
      </div>
    </section>
  );
}

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
