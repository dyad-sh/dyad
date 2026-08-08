import type { ReactNode } from "react";
import { useAtomValue } from "jotai";
import { useNavigate } from "@tanstack/react-router";
import type { BrainiacVoiceState } from "./brainiac-voice-state";
import { cn } from "@/lib/utils";
import { useLoadApps } from "@/hooks/useLoadApps";
import { useOpenApp } from "@/hooks/useOpenApp";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { ListedApp } from "@/ipc/types/app";

// =============================================================================
// Instrument panel chrome — numbered tab + curved leader line into the core
// (composition mirrors the reference HUD). Each panel is an app launcher: the
// numbered cards flank the orb and open one of the user's apps on click.
// =============================================================================

type LinkShape = "down" | "downSoft" | "flat" | "upSoft" | "up";

const LINK_PATHS: Record<LinkShape, { d: string; endY: number }> = {
  down: { d: "M0,6 C42,6 58,34 100,36", endY: 36 },
  downSoft: { d: "M0,12 C45,12 60,27 100,28", endY: 28 },
  flat: { d: "M0,20 C50,20 50,20 100,20", endY: 20 },
  upSoft: { d: "M0,28 C45,28 60,13 100,12", endY: 12 },
  up: { d: "M0,34 C42,34 58,6 100,4", endY: 4 },
};

// Order the leader lines fan from, so any number of cards spreads symmetrically
// around the core instead of bunching toward the top.
const SHAPE_ORDER: LinkShape[] = ["down", "downSoft", "flat", "upSoft", "up"];

function shapeFor(index: number, count: number): LinkShape {
  if (count <= 1) return "flat";
  const i = Math.round((index / (count - 1)) * (SHAPE_ORDER.length - 1));
  return SHAPE_ORDER[i];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function InstrumentPanel({
  side,
  num,
  code,
  shape,
  live,
  onClick,
  title,
  children,
}: {
  side: "left" | "right";
  num: string;
  code: string;
  shape: LinkShape;
  live?: boolean;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
}) {
  const link = LINK_PATHS[shape];
  const tab = (
    <div className={cn("brainiac-ipanel-tab", live && "is-live")} aria-hidden>
      <span className="brainiac-ipanel-num font-jarvis-display">{num}</span>
      <span className="brainiac-ipanel-code font-jarvis-ui">{code}</span>
    </div>
  );
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "brainiac-ipanel brainiac-ipanel--btn",
        `brainiac-ipanel--${side}`,
        live && "brainiac-ipanel--active",
      )}
    >
      {side === "right" && tab}
      <div className="brainiac-ipanel-body">{children}</div>
      {side === "left" && tab}
      <svg
        className="brainiac-ipanel-link"
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        aria-hidden
        focusable="false"
      >
        <path d={link.d} fill="none" />
        <circle
          className="brainiac-ipanel-link-dot"
          cx="97"
          cy={link.endY}
          r="2.6"
        />
      </svg>
    </button>
  );
}

/** App launcher body: glyph tile + app name + launch hint. */
function AppCardBody({ app, active }: { app: ListedApp; active: boolean }) {
  const glyph = app.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="brainiac-ipanel-split">
      <span className="brainiac-file-tile font-jarvis-display" aria-hidden>
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <p className="brainiac-app-name font-jarvis-ui" title={app.name}>
          {app.name}
        </p>
        <p className="brainiac-ipanel-caption font-jarvis-ui">
          {active ? "● ACTIVE" : "OPEN APP"}
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// The two instrument columns — app launchers split left / right around the orb
// =============================================================================

// Up to this many cards flank the orb; the rest stay reachable from the sidebar.
const MAX_CARDS = 10;

export function BrainiacHudPanels({
  side,
}: {
  side: "left" | "right";
  voiceState: BrainiacVoiceState;
}) {
  const navigate = useNavigate();
  const openApp = useOpenApp();
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const { apps } = useLoadApps();

  // Favorites first, then the rest, capped so the cards stay legible. Both
  // columns derive from the same ordered list and split it down the middle.
  const ordered = [...apps]
    .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite))
    .slice(0, MAX_CARDS);
  const leftCount = Math.ceil(ordered.length / 2);
  const sideApps =
    side === "left" ? ordered.slice(0, leftCount) : ordered.slice(leftCount);
  const numOffset = side === "left" ? 0 : leftCount;

  // Empty state: a single "create app" card on the left rail.
  if (ordered.length === 0) {
    if (side === "right") {
      return <div className="brainiac-panels brainiac-panels--right" />;
    }
    return (
      <div className="brainiac-panels brainiac-panels--left">
        <InstrumentPanel
          side="left"
          num="01"
          code="NEW"
          shape="flat"
          onClick={() => navigate({ to: "/coder/studio" })}
          title="Create a new app"
        >
          <div className="brainiac-ipanel-split">
            <span
              className="brainiac-file-tile font-jarvis-display"
              aria-hidden
            >
              +
            </span>
            <div className="min-w-0 flex-1">
              <p className="brainiac-app-name font-jarvis-ui">No apps yet</p>
              <p className="brainiac-ipanel-caption font-jarvis-ui">
                CREATE ONE
              </p>
            </div>
          </div>
        </InstrumentPanel>
      </div>
    );
  }

  return (
    <div className={cn("brainiac-panels", `brainiac-panels--${side}`)}>
      {sideApps.map((app, i) => (
        <InstrumentPanel
          key={app.id}
          side={side}
          num={pad2(numOffset + i + 1)}
          code="APP"
          shape={shapeFor(i, sideApps.length)}
          live={selectedAppId === app.id}
          onClick={() => openApp(app.id)}
          title={`Open ${app.name}`}
        >
          <AppCardBody app={app} active={selectedAppId === app.id} />
        </InstrumentPanel>
      ))}
    </div>
  );
}
