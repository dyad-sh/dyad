import { Link } from "@tanstack/react-router";
import { ArrowRight, DraftingCompass } from "lucide-react";

import { ParticleBackground } from "@/components/home/ParticleBackground";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  BUILD_CATEGORIES,
  DEFAULT_BUILD_CATEGORY,
  buildToolsInCategory,
  findBuildCategory,
  type BuildCategoryId,
} from "@/lib/build_sections";

/**
 * Build — physical engineering, one level of categories deep.
 *
 * The rail selects a discipline, the page below launches the tools in it.
 * Tools are never in the rail itself: three icons stay three icons however
 * many tools arrive, which is the whole reason for the level in between.
 *
 * A category with no tools yet says exactly that. The alternative, a card for
 * something that does not exist, would read as a feature and open nothing.
 */

function CategoryRail({ active }: { active: BuildCategoryId }) {
  return (
    <nav
      aria-label="Build categories"
      className="flex shrink-0 flex-col items-center gap-1.5 border-r border-cyan-500/12 bg-[rgba(4,12,24,0.6)] px-2 py-4"
      data-testid="build-category-rail"
    >
      {BUILD_CATEGORIES.map((category) => {
        const isActive = category.id === active;
        return (
          <Tooltip key={category.id}>
            <TooltipTrigger
              render={
                <Link
                  to={category.route}
                  aria-label={category.label}
                  aria-current={isActive ? "page" : undefined}
                  data-testid={`build-rail-${category.id}`}
                  className={cn(
                    "grid size-10 place-items-center rounded-lg text-cyan-100/45 outline-none transition-colors",
                    "hover:bg-cyan-500/10 hover:text-cyan-100",
                    "focus-visible:ring-2 focus-visible:ring-cyan-400/40",
                    isActive &&
                      "border border-cyan-400/25 bg-cyan-500/12 text-cyan-200 shadow-[0_0_18px_rgba(0,229,255,0.18)]",
                  )}
                >
                  <category.icon className="size-5 shrink-0" />
                </Link>
              }
            />
            <TooltipContent side="right" align="center">
              {category.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

export default function BuildPage({
  category: categoryId,
}: {
  category: BuildCategoryId;
}) {
  const category = findBuildCategory(categoryId) ?? BUILD_CATEGORIES[0];
  const tools = buildToolsInCategory(category.id);

  return (
    <div className="settings-jarvis home-jarvis relative flex min-h-full w-full overflow-hidden bg-background">
      <ParticleBackground className="z-0" />

      <div className="relative z-10 flex min-h-0 w-full flex-1">
        <CategoryRail active={category.id} />

        <div className="min-w-0 flex-1 overflow-auto">
          <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
            <header className="mb-8 max-w-2xl">
              <div className="mb-3 flex items-center gap-2.5">
                <div className="manager-brand-icon">
                  <DraftingCompass className="size-4" />
                </div>
                <span className="manager-brand-label font-jarvis-ui">
                  BUILD / {category.label.toUpperCase()}
                </span>
                <div className="manager-status-dot manager-status-dot--active" />
              </div>
              <h1 className="manager-title font-jarvis-display">
                {category.label}
              </h1>
              <p className="manager-subtitle">{category.summary}</p>
            </header>

            {tools.length > 0 ? (
              <section className="grid grid-cols-1 items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {tools.map((tool) => (
                  <Link
                    key={tool.id}
                    to={tool.route}
                    className="ops-holo-card group flex aspect-square flex-col justify-between p-5"
                    data-testid={tool.testId}
                  >
                    <div className="relative z-10">
                      <div className="mb-5 grid size-12 place-items-center rounded-2xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 shadow-[0_0_18px_rgba(0,229,255,0.25)]">
                        <tool.icon className="size-5" />
                      </div>
                      <h2 className="font-jarvis-display text-xl font-semibold tracking-tight text-white">
                        {tool.title}
                      </h2>
                      <p className="mt-2 max-w-sm text-sm leading-6 text-[#7aadb8]">
                        {tool.description}
                      </p>
                    </div>
                    <div className="relative z-10 mt-6 flex items-center gap-2 text-sm font-medium text-cyan-300">
                      Open
                      <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                    </div>
                  </Link>
                ))}
              </section>
            ) : (
              <section
                className="rounded-2xl border border-cyan-500/12 bg-[rgba(6,18,34,0.55)] p-10 text-center"
                data-testid={`build-empty-${category.id}`}
              >
                <category.icon className="mx-auto mb-3 size-6 text-cyan-300/70" />
                <p className="text-sm text-[#7aadb8]">
                  No {category.label.toLowerCase()} tools yet. Ones added to
                  Meta Human OS will appear here.
                </p>
              </section>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

/** What the retired /engineering path renders. */
export function BuildLegacyRoute() {
  return <BuildPage category={DEFAULT_BUILD_CATEGORY} />;
}
