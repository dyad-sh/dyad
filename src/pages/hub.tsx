import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LayoutTemplate, Plus } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { useSettings } from "@/hooks/useSettings";
import { useTemplates } from "@/hooks/useTemplates";
import { TemplateCard } from "@/components/TemplateCard";
import { CreateAppDialog } from "@/components/CreateAppDialog";
import { PageContainer } from "@/components/PageContainer";
import { isIpcRendererAvailable } from "@/ipc/contracts/core";
import { DEFAULT_TEMPLATE_ID } from "@/shared/templates";
import { ParticleBackground } from "@/components/home/ParticleBackground";

const TEMPLATE_GRID_CLASS =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

function TemplateGallerySection({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description?: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          {count} {count === 1 ? "template" : "templates"}
        </span>
      </div>
      <div className={TEMPLATE_GRID_CLASS}>{children}</div>
    </section>
  );
}

const HubPage: React.FC = () => {
  const router = useRouter();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [browserSelectedTemplateId, setBrowserSelectedTemplateId] =
    useState(DEFAULT_TEMPLATE_ID);
  const { templates, isLoading } = useTemplates();
  const { settings, updateSettings } = useSettings();
  const hasIpcRenderer = isIpcRendererAvailable();
  const selectedTemplateId = hasIpcRenderer
    ? settings?.selectedTemplateId
    : browserSelectedTemplateId;

  const handleTemplateSelect = (templateId: string) => {
    if (!hasIpcRenderer) {
      setBrowserSelectedTemplateId(templateId);
      return;
    }
    void updateSettings({ selectedTemplateId: templateId });
  };

  const handleCreateApp = () => {
    if (!hasIpcRenderer) return;
    setIsCreateDialogOpen(true);
  };

  const officialTemplates =
    templates?.filter((template) => template.isOfficial) || [];
  const communityTemplates =
    templates?.filter((template) => !template.isOfficial) || [];

  const selectedTemplate = templates?.find((t) => t.id === selectedTemplateId);

  return (
    <div className="home-jarvis relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ParticleBackground className="z-0" />
      <div
        className="relative z-10 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
        data-reset-scroll-on-route
      >
        <PageContainer size="xl" innerClassName="pb-8">
          <Button
            onClick={() => router.history.back()}
            variant="ghost"
            size="sm"
            className="mb-6 -ml-2 gap-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Go Back
          </Button>

          <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-primary">
                <LayoutTemplate className="size-5 shrink-0" />
                <span className="text-xs font-semibold uppercase tracking-widest">
                  Templates
                </span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Pick your default template
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
                Choose a starting point for new projects. Click a card to set
                your default, then create an app when you are ready.
                {isLoading && " Loading community templates…"}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {selectedTemplate && (
                <span
                  className="inline-flex max-w-[min(100%,16rem)] items-center rounded-full border border-border/70 bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground"
                  data-testid="hub-selected-template-label"
                >
                  <span className="truncate">
                    Default:{" "}
                    <span className="font-medium text-foreground">
                      {selectedTemplate.title}
                    </span>
                  </span>
                </span>
              )}
              <Button
                size="sm"
                onClick={handleCreateApp}
                disabled={!selectedTemplate || !hasIpcRenderer}
                title={
                  hasIpcRenderer
                    ? undefined
                    : "Open Meta Human OS as a desktop app to create projects"
                }
                data-testid="hub-create-app-button"
                className="gap-1.5"
              >
                <Plus className="size-4" />
                Create app
              </Button>
            </div>
          </header>

          {officialTemplates.length > 0 && (
            <TemplateGallerySection
              title="Official templates"
              description="Maintained by the Meta Human OS team — recommended for most projects."
              count={officialTemplates.length}
            >
              {officialTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  isSelected={template.id === selectedTemplateId}
                  onSelect={handleTemplateSelect}
                  onCreateApp={handleCreateApp}
                />
              ))}
            </TemplateGallerySection>
          )}

          {communityTemplates.length > 0 && (
            <TemplateGallerySection
              title="Community templates"
              description="Built by the community. Review the source before use."
              count={communityTemplates.length}
            >
              {communityTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  isSelected={template.id === selectedTemplateId}
                  onSelect={handleTemplateSelect}
                  onCreateApp={handleCreateApp}
                />
              ))}
            </TemplateGallerySection>
          )}

          <CreateAppDialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
            template={selectedTemplate}
          />
        </PageContainer>
      </div>
    </div>
  );
};

export default HubPage;
