import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import type { ChatAgentToolPresentation } from "@/ipc/types/chat_agent";
import { ipc } from "@/ipc/types";

type MapPresentation = Extract<
  ChatAgentToolPresentation,
  { kind: "map-places" }
>;

type MapDimensions = {
  width: number;
  height: number;
};

type MapPoint = {
  x: number;
  y: number;
};

const TILE_SIZE = 256;
const DEFAULT_MAP_DIMENSIONS: MapDimensions = { width: 640, height: 256 };
const MAX_MERCATOR_LATITUDE = 85.05112878;
const CARTO_BASEMAP_BY_STYLE: Record<MapPresentation["style"], string> = {
  dark: "dark_all",
  liberty: "voyager",
  positron: "light_all",
};

function placeLabel(place: MapPresentation["places"][number]) {
  return [place.name, place.admin1, place.country].filter(Boolean).join(", ");
}

function openPlace(place: MapPresentation["places"][number]) {
  const url = new URL("https://www.openstreetmap.org/");
  url.searchParams.set("mlat", String(place.latitude));
  url.searchParams.set("mlon", String(place.longitude));
  url.hash = `map=12/${place.latitude}/${place.longitude}`;
  void ipc.system.openExternalUrl(url.toString());
}

function toWorldPoint(latitude: number, longitude: number): MapPoint {
  const clampedLatitude = Math.max(
    -MAX_MERCATOR_LATITUDE,
    Math.min(MAX_MERCATOR_LATITUDE, latitude),
  );
  const sinLatitude = Math.sin((clampedLatitude * Math.PI) / 180);

  return {
    x: (longitude + 180) / 360,
    y: 0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI),
  };
}

function fitZoom(points: MapPoint[], dimensions: MapDimensions) {
  if (points.length === 1) return 13;

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const xSpan = Math.max(...xValues) - Math.min(...xValues);
  const ySpan = Math.max(...yValues) - Math.min(...yValues);
  const availableWidth = Math.max(1, dimensions.width - 112);
  const availableHeight = Math.max(1, dimensions.height - 96);

  for (let zoom = 13; zoom >= 1; zoom -= 1) {
    const worldSize = TILE_SIZE * 2 ** zoom;
    if (
      xSpan * worldSize <= availableWidth &&
      ySpan * worldSize <= availableHeight
    ) {
      return zoom;
    }
  }

  return 1;
}

function RasterMap({ presentation }: { presentation: MapPresentation }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState(DEFAULT_MAP_DIMENSIONS);
  const [hasLoadedTile, setHasLoadedTile] = useState(false);
  const [failedTileCount, setFailedTileCount] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateDimensions = () => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        setDimensions({ width: bounds.width, height: bounds.height });
      }
    };

    updateDimensions();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateDimensions);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const mapLayout = useMemo(() => {
    const worldPoints = presentation.places.map((place) =>
      toWorldPoint(place.latitude, place.longitude),
    );
    const zoom = fitZoom(worldPoints, dimensions);
    const scale = TILE_SIZE * 2 ** zoom;
    const pixelPoints = worldPoints.map((point) => ({
      x: point.x * scale,
      y: point.y * scale,
    }));
    const center = {
      x:
        (Math.min(...pixelPoints.map((point) => point.x)) +
          Math.max(...pixelPoints.map((point) => point.x))) /
        2,
      y:
        (Math.min(...pixelPoints.map((point) => point.y)) +
          Math.max(...pixelPoints.map((point) => point.y))) /
        2,
    };
    const viewportOrigin = {
      x: center.x - dimensions.width / 2,
      y: center.y - dimensions.height / 2,
    };
    const minimumTileX = Math.floor(viewportOrigin.x / TILE_SIZE);
    const maximumTileX = Math.floor(
      (viewportOrigin.x + dimensions.width) / TILE_SIZE,
    );
    const minimumTileY = Math.floor(viewportOrigin.y / TILE_SIZE);
    const maximumTileY = Math.floor(
      (viewportOrigin.y + dimensions.height) / TILE_SIZE,
    );
    const tileLimit = 2 ** zoom;
    const basemap = CARTO_BASEMAP_BY_STYLE[presentation.style];
    const tiles: Array<{
      key: string;
      left: number;
      top: number;
      url: string;
    }> = [];

    for (let tileY = minimumTileY; tileY <= maximumTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tileLimit) continue;
      for (let tileX = minimumTileX; tileX <= maximumTileX; tileX += 1) {
        const wrappedTileX = ((tileX % tileLimit) + tileLimit) % tileLimit;
        tiles.push({
          key: `${zoom}-${wrappedTileX}-${tileY}`,
          left: tileX * TILE_SIZE - viewportOrigin.x,
          top: tileY * TILE_SIZE - viewportOrigin.y,
          url: `https://basemaps.cartocdn.com/${basemap}/${zoom}/${wrappedTileX}/${tileY}@2x.png`,
        });
      }
    }

    return {
      tiles,
      pins: presentation.places.map((place, index) => ({
        place,
        left: pixelPoints[index].x - viewportOrigin.x,
        top: pixelPoints[index].y - viewportOrigin.y,
      })),
    };
  }, [dimensions, presentation]);

  const tileSignature = mapLayout.tiles.map((tile) => tile.key).join("|");
  useEffect(() => {
    setHasLoadedTile(false);
    setFailedTileCount(0);
  }, [tileSignature]);

  const allTilesFailed =
    mapLayout.tiles.length > 0 && failedTileCount >= mapLayout.tiles.length;

  return (
    <div
      ref={containerRef}
      className="relative h-64 overflow-hidden border-y border-cyan-400/10 bg-[#071426]"
      data-testid="chat-agent-interactive-map"
    >
      {mapLayout.tiles.map((tile) => (
        <img
          key={tile.key}
          src={tile.url}
          alt=""
          className="pointer-events-none absolute size-64 max-w-none select-none"
          style={{ left: tile.left, top: tile.top }}
          draggable={false}
          data-testid="chat-agent-map-tile"
          onLoad={() => setHasLoadedTile(true)}
          onError={() => setFailedTileCount((count) => count + 1)}
        />
      ))}

      <div className="pointer-events-none absolute inset-0 bg-cyan-950/5" />

      {mapLayout.pins.map(({ place, left, top }) => (
        <button
          key={place.id}
          type="button"
          aria-label={`Open ${placeLabel(place)} in OpenStreetMap`}
          title={placeLabel(place)}
          className="absolute z-10 grid size-7 -translate-x-1/2 -translate-y-full place-items-center rounded-full border-2 border-[#071426] bg-cyan-400 text-[#071426] shadow-[0_0_0_3px_rgba(34,211,238,0.35),0_6px_18px_rgba(0,0,0,0.4)] transition-transform hover:scale-110"
          style={{ left, top }}
          onClick={() => openPlace(place)}
        >
          <MapPin className="size-4" />
        </button>
      ))}

      {!hasLoadedTile && !allTilesFailed && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[#071426]">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.06)_1px,transparent_1px)] bg-[size:32px_32px]" />
          <div className="absolute inset-x-8 top-1/2 h-px animate-pulse bg-cyan-300/35 shadow-[0_0_16px_rgba(34,211,238,0.45)]" />
          <div className="absolute inset-0 grid place-items-center text-xs text-cyan-100/45">
            Loading map image…
          </div>
        </div>
      )}

      {allTilesFailed && (
        <div className="absolute inset-0 grid place-items-center bg-[#071426] px-6 text-center text-sm text-cyan-100/50">
          Map imagery is unavailable, but the locations below can still be
          opened.
        </div>
      )}
    </div>
  );
}

export function ChatAgentMapCard({
  presentation,
}: {
  presentation: MapPresentation;
}) {
  return (
    <section className="chat-card-fly-in mt-3 overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#061225]/95 shadow-[0_0_28px_rgba(0,229,255,0.07)]">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300">
            <MapPin className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-cyan-50">Map results</div>
            <div className="truncate text-xs text-cyan-100/45">
              {presentation.places.length} locations · {presentation.query}
            </div>
          </div>
        </div>
        <span className="text-[0.65rem] text-cyan-100/35">
          CARTO + OpenStreetMap
        </span>
      </header>

      {presentation.places.length > 0 ? (
        <>
          <RasterMap presentation={presentation} />
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            {presentation.places.map((place) => (
              <button
                key={place.id}
                type="button"
                className="group flex min-w-0 items-center gap-3 rounded-xl border border-cyan-400/10 bg-cyan-400/4 p-3 text-left transition-colors hover:border-cyan-300/30 hover:bg-cyan-400/8"
                onClick={() => openPlace(place)}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-cyan-400/10 text-cyan-300">
                  <MapPin className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-cyan-50">
                    {place.name}
                  </span>
                  <span className="block truncate text-xs text-cyan-100/40">
                    {[place.admin1, place.country].filter(Boolean).join(", ") ||
                      `${place.latitude.toFixed(3)}, ${place.longitude.toFixed(3)}`}
                  </span>
                </span>
                <ExternalLink className="size-3.5 shrink-0 text-cyan-100/35 group-hover:text-cyan-300" />
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="border-t border-cyan-400/10 px-4 py-5 text-sm text-cyan-100/45">
          No matching locations were found. Try a city, region, or postcode.
        </p>
      )}

      <footer className="border-t border-cyan-400/10 px-4 py-2 text-[10px] text-cyan-100/35">
        Map tiles © CARTO · map data © OpenStreetMap contributors
      </footer>
    </section>
  );
}
