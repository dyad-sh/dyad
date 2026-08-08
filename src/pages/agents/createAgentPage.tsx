import type { LucideIcon } from "lucide-react";
import { PageContainer } from "@/components/PageContainer";

export type AgentPageConfig = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function createAgentPage({
  title,
  description,
  icon: Icon,
}: AgentPageConfig) {
  return function AgentPage() {
    return (
      <PageContainer size="lg" innerClassName="pb-8">
        <header className="mb-8 flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-cyan-500/25 bg-cyan-500/10 text-primary">
            <Icon className="size-6" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </header>
        <p className="text-sm text-muted-foreground">
          This agent workspace is coming soon.
        </p>
      </PageContainer>
    );
  };
}
