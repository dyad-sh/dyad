import { Link } from "@tanstack/react-router";
import { ArrowRight, DraftingCompass } from "lucide-react";

import { ParticleBackground } from "@/components/home/ParticleBackground";
import {
  BUILD_CATEGORIES,
  buildToolsInCategory,
  findBuildCategory,
  type BuildCategoryId,
} from "@/lib/build_sections";

/**
 * Build — physical engineering, one level of categories deep.
 *
 * Build lists its disciplines as cards; a discipline lists its tools as cards.
 * The level in between is the point: however many tools arrive, Build itself
 * still shows three things, and a new tool is an entry in the registry rather
 * than a change to navigation.
 *
 * A category with no tools yet says exactly that. A card for something that
 * does not exist would read as a feature and open nothing.
 */

function BuildShell({
  brand,
  title,
  subtitle,
  children,
}: {
  brand: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-jarvis home-jarvis relative flex min-h-full w-full flex-col overflow-auto bg-background">
      <ParticleBackground className="z-0" />
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 max-w-2xl">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="manager-brand-icon">
              <DraftingCompass className="size-4" />
            </div>
            <span className="manager-brand-label font-jarvis-ui">{brand}</span>
            <div className="manager-status-dot manager-status-dot--active" />
          </div>
          <h1 className="manager-title font-jarvis-display">{title}</h1>
          <p className="manager-subtitle">{subtitle}</p>
        </header>
        {children}
      </main>
    </div>
  );
}

/** The card used for both a discipline and a tool: one visual language. */
function BuildCard({
  to,
  icon: Icon,
  title,
  description,
  footnote,
  testId,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  footnote?: string;
  testId: string;
}) {
  return (
    <Link
      to={to}
      className="ops-holo-card group flex aspect-square flex-col justify-between p-5"
      data-testid={testId}
    >
      <div className="relative z-10">
        <div className="mb-5 grid size-12 place-items-center rounded-2xl border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 shadow-[0_0_18px_rgba(0,229,255,0.25)]">
          <Icon className="size-5" />
        </div>
        <h2 className="font-jarvis-display text-xl font-semibold tracking-tight text-white">
          {title}
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-[#7aadb8]">
          {description}
        </p>
      </div>
      <div className="relative z-10 mt-6 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-cyan-300">
          Open
          <ArrowRight className="size-4 transition group-hover:translate-x-1" />
        </span>
        {/* Counted, never estimated: an empty category says so. */}
        {footnote && (
          <span className="text-[11px] text-cyan-100/35">{footnote}</span>
        )}
      </div>
    </Link>
  );
}

const CARD_GRID =
  "grid grid-cols-1 items-start gap-5 sm:grid-cols-2 lg:grid-cols-3";

/** Build itself: the three disciplines, as cards. */
export default function BuildPage() {
  return (
    <BuildShell
      brand="BUILD"
      title="Design machines, not slide decks."
      subtitle="Tools for designing physical things: electronics, mechanical assemblies, and the making of them."
    >
      <section className={CARD_GRID}>
        {BUILD_CATEGORIES.map((category) => {
          const count = buildToolsInCategory(category.id).length;
          return (
            <BuildCard
              key={category.id}
              to={category.route}
              icon={category.icon}
              title={category.label}
              description={category.summary}
              footnote={
                count === 0
                  ? "No tools yet"
                  : `${count} ${count === 1 ? "tool" : "tools"}`
              }
              testId={`build-category-${category.id}`}
            />
          );
        })}
      </section>
    </BuildShell>
  );
}

/** A discipline: the tools inside it, as cards. */
export function BuildCategoryPage({
  category: categoryId,
}: {
  category: BuildCategoryId;
}) {
  const category = findBuildCategory(categoryId) ?? BUILD_CATEGORIES[0];
  const tools = buildToolsInCategory(category.id);

  return (
    <BuildShell
      brand={`BUILD / ${category.label.toUpperCase()}`}
      title={category.label}
      subtitle={category.summary}
    >
      {tools.length > 0 ? (
        <section className={CARD_GRID}>
          {tools.map((tool) => (
            <BuildCard
              key={tool.id}
              to={tool.route}
              icon={tool.icon}
              title={tool.title}
              description={tool.description}
              testId={tool.testId}
            />
          ))}
        </section>
      ) : (
        <section
          className="rounded-2xl border border-cyan-500/12 bg-[rgba(6,18,34,0.55)] p-10 text-center"
          data-testid={`build-empty-${category.id}`}
        >
          <category.icon className="mx-auto mb-3 size-6 text-cyan-300/70" />
          <p className="text-sm text-[#7aadb8]">
            No {category.label.toLowerCase()} tools yet. Ones added to Meta
            Human OS will appear here.
          </p>
        </section>
      )}
    </BuildShell>
  );
}

/** What the retired /engineering path renders. */
export function BuildLegacyRoute() {
  return <BuildPage />;
}
