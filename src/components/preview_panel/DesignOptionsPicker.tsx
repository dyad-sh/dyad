import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { ipc } from "@/ipc/types";
import type {
  DesignOptionsData,
  DesignPlatform,
  DesignPaletteOption,
  DesignShapeOption,
  DesignTypographyOption,
} from "@/ipc/types/design";

const PLATFORM_LABELS: Record<DesignPlatform, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  both: "Both",
};

/** A selectable card. Selection is a border + check, so the option's own colors
 *  and type stay the thing being judged rather than competing with chrome. */
function OptionCard({
  selected,
  onSelect,
  label,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={label}
      className={`relative flex-1 rounded-lg border p-3 text-left transition ${
        selected
          ? "border-primary ring-1 ring-primary"
          : "border-border hover:border-muted-foreground/50"
      }`}
    >
      {selected && (
        <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
      {children}
    </button>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function PalettePreview({ option }: { option: DesignPaletteOption }) {
  const swatches = [
    option.palette.background,
    option.palette.surface,
    option.palette.primary,
    option.palette.accent,
    option.palette.text,
  ];
  return (
    <>
      <div className="mb-2 flex gap-1">
        {swatches.map((c, i) => (
          <span
            key={i}
            className="h-6 w-6 rounded border border-border"
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="text-sm font-medium text-foreground">{option.name}</div>
      {option.rationale && (
        <div className="mt-0.5 text-xs text-muted-foreground">
          {option.rationale}
        </div>
      )}
    </>
  );
}

/** Renders the pairing in the actual fonts — the roster is loaded in the app,
 *  so the preview shows what the mockups will really use. */
function TypographyPreview({ option }: { option: DesignTypographyOption }) {
  return (
    <>
      <div
        className="text-2xl leading-tight text-foreground"
        style={{ fontFamily: `"${option.headingFont}"` }}
      >
        Braised four hours
      </div>
      <div
        className="mt-1 text-xs text-muted-foreground"
        style={{ fontFamily: `"${option.bodyFont}"` }}
      >
        A short menu that changes when the market does.
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground/70">
        {option.headingFont} / {option.bodyFont}
      </div>
      {option.rationale && (
        <div className="mt-1 text-xs text-muted-foreground">
          {option.rationale}
        </div>
      )}
    </>
  );
}

function ShapePreview({ option }: { option: DesignShapeOption }) {
  return (
    <>
      <div
        className="mb-2 h-8 w-full bg-foreground"
        // Mirrors what the mockup will draw, so the choice is visible rather
        // than a number the user has to imagine.
        style={{ borderRadius: Math.min(option.cornerRadius, 16) }}
      />
      <div className="text-sm font-medium text-foreground">{option.label}</div>
      <div className="text-xs text-muted-foreground">
        {option.cornerRadius}px
      </div>
    </>
  );
}

/**
 * The pre-generation choice step: the agent proposes tailored options and
 * blocks until the user picks. Everything defaults to the first option so
 * Continue is always available — the point is to let the user steer, not to
 * make them fill in a form.
 */
export function DesignOptionsPicker({
  chatId,
  data,
  onResolved,
}: {
  chatId: number;
  data: DesignOptionsData;
  onResolved: (chatId: number) => void;
}) {
  const [directionId, setDirectionId] = useState(data.directions[0].id);
  const [paletteId, setPaletteId] = useState(data.palettes[0].id);
  const [typographyId, setTypographyId] = useState(data.typography[0].id);
  const [shapeId, setShapeId] = useState(data.shapes[0].id);
  const [platform, setPlatform] = useState<DesignPlatform>(data.platforms[0]);
  const [submitting, setSubmitting] = useState(false);

  const respond = async (
    selection: {
      directionId: string;
      paletteId: string;
      typographyId: string;
      shapeId: string;
      platform: DesignPlatform;
    } | null,
  ) => {
    setSubmitting(true);
    try {
      await ipc.design.respondToDesignOptions({
        requestId: data.requestId,
        selection,
      });
      onResolved(chatId);
    } catch {
      // The agent may have already moved on (stream cancelled/timed out).
      // Retire the picker either way rather than trapping the user with it.
      onResolved(chatId);
    }
  };

  const selectedDirection = useMemo(
    () => data.directions.find((d) => d.id === directionId),
    [data.directions, directionId],
  );

  return (
    <div
      className="mb-6 rounded-lg border border-border bg-muted/30 p-4"
      data-testid="design-options-picker"
    >
      <h2 className="text-base font-semibold text-foreground">
        Pick a direction
      </h2>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        These shape every screen. You can change any of it afterwards.
      </p>

      <Section title="Direction">
        {data.directions.map((d) => (
          <OptionCard
            key={d.id}
            label={d.title}
            selected={d.id === directionId}
            onSelect={() => setDirectionId(d.id)}
          >
            <div className="text-sm font-medium text-foreground">{d.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {d.pitch}
            </div>
          </OptionCard>
        ))}
      </Section>

      <Section title="Palette">
        {data.palettes.map((p) => (
          <OptionCard
            key={p.id}
            label={p.name}
            selected={p.id === paletteId}
            onSelect={() => setPaletteId(p.id)}
          >
            <PalettePreview option={p} />
          </OptionCard>
        ))}
      </Section>

      <Section title="Typography">
        {data.typography.map((t) => (
          <OptionCard
            key={t.id}
            label={`${t.headingFont} with ${t.bodyFont}`}
            selected={t.id === typographyId}
            onSelect={() => setTypographyId(t.id)}
          >
            <TypographyPreview option={t} />
          </OptionCard>
        ))}
      </Section>

      <Section title="Shape">
        {data.shapes.map((s) => (
          <OptionCard
            key={s.id}
            label={s.label}
            selected={s.id === shapeId}
            onSelect={() => setShapeId(s.id)}
          >
            <ShapePreview option={s} />
          </OptionCard>
        ))}
      </Section>

      {data.platforms.length > 1 && (
        <Section title="Platform">
          {data.platforms.map((p) => (
            <OptionCard
              key={p}
              label={PLATFORM_LABELS[p]}
              selected={p === platform}
              onSelect={() => setPlatform(p)}
            >
              <div className="text-sm font-medium text-foreground">
                {PLATFORM_LABELS[p]}
              </div>
            </OptionCard>
          ))}
        </Section>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={() =>
            respond({
              directionId,
              paletteId,
              typographyId,
              shapeId,
              platform,
            })
          }
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting
            ? "Designing…"
            : `Design with "${selectedDirection?.title ?? "this"}"`}
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => respond(null)}
          className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          None of these
        </button>
      </div>
    </div>
  );
}
