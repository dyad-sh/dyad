import { Palette, LayoutTemplate, Loader2 } from "lucide-react";

interface DesignBriefCardProps {
  appName: string;
  primaryColor: string;
  interfaces: number;
  inProgress: boolean;
}

/**
 * Compact chat card summarizing a committed design brief. The full visual system
 * (palette, typography, mockups) renders in the Design preview panel.
 */
export function DyadDesignBriefCard({
  appName,
  primaryColor,
  interfaces,
  inProgress,
}: DesignBriefCardProps) {
  return (
    <div
      className="my-2 flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
      data-testid="dyad-design-brief-card"
    >
      {primaryColor ? (
        <span
          className="h-6 w-6 shrink-0 rounded border border-border"
          style={{ backgroundColor: primaryColor }}
        />
      ) : (
        <Palette size={18} className="shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Palette size={13} className="text-pink-500" />
          {appName || "Design brief"}
        </div>
        <div className="text-xs text-muted-foreground">
          {inProgress
            ? "Deciding the visual system…"
            : `Visual system ready · ${interfaces} screen${
                interfaces === 1 ? "" : "s"
              } to design`}
        </div>
      </div>
      {inProgress && (
        <Loader2
          size={14}
          className="shrink-0 animate-spin text-muted-foreground"
        />
      )}
    </div>
  );
}

interface DesignInterfaceCardProps {
  name: string;
  inProgress: boolean;
}

/**
 * Compact chat card marking a generated interface. The mockup renders in the
 * Design preview panel.
 */
export function DyadDesignInterfaceCard({
  name,
  inProgress,
}: DesignInterfaceCardProps) {
  return (
    <div
      className="my-2 flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2"
      data-testid="dyad-design-interface-card"
    >
      <LayoutTemplate size={18} className="shrink-0 text-pink-500" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">
          {name || "Interface"}
        </div>
        <div className="text-xs text-muted-foreground">
          {inProgress
            ? "Laying out the screen…"
            : "Mockup ready · see the Design panel"}
        </div>
      </div>
      {inProgress && (
        <Loader2
          size={14}
          className="shrink-0 animate-spin text-muted-foreground"
        />
      )}
    </div>
  );
}
