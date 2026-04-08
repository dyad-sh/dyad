import { useEffect, useMemo, useState } from "react";
import { useLoadAppFile } from "@/hooks/useLoadAppFile";
import { useLoadApp } from "@/hooks/useLoadApp";
import { ipc } from "@/ipc/types";

export interface ParsedRoute {
  path: string;
  label: string;
}

/**
 * Builds a human-readable label from a route path.
 */
export function buildRouteLabel(path: string): string {
  return path === "/"
    ? "Home"
    : path
        .split("/")
        .filter((segment) => segment && !segment.startsWith(":"))
        .pop()
        ?.replace(/[-_]/g, " ")
        .replace(/^\w/, (c) => c.toUpperCase()) || path;
}

/**
 * Finds files in the app's file list that are likely to contain route definitions.
 * Matches filenames containing "route" or "routes" (case-insensitive).
 */
export function findRouteFiles(files: string[]): string[] {
  return files.filter((f) => {
    const basename = f.split("/").pop() || "";
    return /routes?\./i.test(basename) && /\.[jt]sx?$/.test(basename);
  });
}

/**
 * Merges route arrays, deduplicating by path.
 */
function mergeRoutes(
  primary: ParsedRoute[],
  ...rest: ParsedRoute[][]
): ParsedRoute[] {
  const merged = [...primary];
  for (const routes of rest) {
    for (const route of routes) {
      if (!merged.some((r) => r.path === route.path)) {
        merged.push(route);
      }
    }
  }
  return merged;
}

/**
 * Parses routes from a React Router file content (e.g., App.tsx).
 * Extracts route paths from <Route path="..." /> elements.
 */
export function parseRoutesFromRouterFile(
  content: string | null,
): ParsedRoute[] {
  if (!content) {
    return [];
  }

  try {
    const parsedRoutes: ParsedRoute[] = [];
    const routePathsRegex = /<Route\s+(?:[^>]*\s+)?path=["']([^"']+)["']/g;
    let match: RegExpExecArray | null;

    while ((match = routePathsRegex.exec(content)) !== null) {
      const path = match[1];
      // Skip wildcard/catch-all routes like "*" - they are not valid navigation targets
      // and cause 'Invalid URL' TypeError when clicked
      if (path === "*" || path === "/*") continue;
      const label = buildRouteLabel(path);
      if (!parsedRoutes.some((r) => r.path === path)) {
        parsedRoutes.push({ path, label });
      }
    }
    return parsedRoutes;
  } catch (e) {
    console.error("Error parsing router file:", e);
    return [];
  }
}

/**
 * Parses routes from Next.js file-based routing (pages/ or app/ directories).
 */
export function parseRoutesFromNextFiles(files: string[]): ParsedRoute[] {
  const nextRoutes = new Set<string>();

  // pages directory (pages router)
  const pageFileRegex = /^(?:pages)\/(.+)\.(?:js|jsx|ts|tsx|mdx)$/i;
  for (const file of files) {
    if (!file.startsWith("pages/")) continue;
    if (file.startsWith("pages/api/")) continue; // skip api routes
    const baseName = file.split("/").pop() || "";
    if (baseName.startsWith("_")) continue; // _app, _document, etc.

    const m = file.match(pageFileRegex);
    if (!m) continue;
    let routePath = m[1];

    // Ignore dynamic routes containing [ ]
    if (routePath.includes("[")) continue;

    // Normalize index files
    if (routePath === "index") {
      nextRoutes.add("/");
      continue;
    }
    if (routePath.endsWith("/index")) {
      routePath = routePath.slice(0, -"/index".length);
    }

    nextRoutes.add("/" + routePath);
  }

  // app directory (app router)
  const appPageRegex = /^(?:src\/)?app\/(.*)\/page\.(?:js|jsx|ts|tsx|mdx)$/i;
  for (const file of files) {
    const lower = file.toLowerCase();
    if (
      lower === "app/page.tsx" ||
      lower === "app/page.jsx" ||
      lower === "app/page.js" ||
      lower === "app/page.mdx" ||
      lower === "app/page.ts" ||
      lower === "src/app/page.tsx" ||
      lower === "src/app/page.jsx" ||
      lower === "src/app/page.js" ||
      lower === "src/app/page.mdx" ||
      lower === "src/app/page.ts"
    ) {
      nextRoutes.add("/");
      continue;
    }
    const m = file.match(appPageRegex);
    if (!m) continue;
    const routeSeg = m[1];
    // Ignore dynamic segments and grouping folders like (marketing)
    if (routeSeg.includes("[")) continue;
    const cleaned = routeSeg
      .split("/")
      .filter((s) => s && !s.startsWith("("))
      .join("/");
    if (!cleaned) {
      nextRoutes.add("/");
    } else {
      nextRoutes.add("/" + cleaned);
    }
  }

  return Array.from(nextRoutes).map((path) => ({
    path,
    label: buildRouteLabel(path),
  }));
}

/**
 * Loads the app router file and parses available routes for quick navigation.
 * Falls back to scanning imported route files when App.tsx contains no inline routes.
 */
export function useParseRouter(appId: number | null) {
  const [routes, setRoutes] = useState<ParsedRoute[]>([]);
  const [importedRoutes, setImportedRoutes] = useState<ParsedRoute[]>([]);

  // Load app to access the file list
  const {
    app,
    loading: appLoading,
    error: appError,
    refreshApp,
  } = useLoadApp(appId);

  // Load router related file to extract routes for non-Next apps
  const {
    content: routerContent,
    loading: routerFileLoading,
    error: routerFileError,
    refreshFile,
  } = useLoadAppFile(appId, "src/App.tsx");

  // Detect Next.js app by presence of next.config.* in file list
  const isNextApp = useMemo(() => {
    if (!app?.files) return false;
    return app.files.some((f) => f.toLowerCase().includes("next.config"));
  }, [app?.files]);

  // When no routes found in App.tsx, scan route-named files for route definitions
  useEffect(() => {
    if (isNextApp || !appId || !app?.files) {
      setImportedRoutes([]);
      return;
    }
    const directRoutes = parseRoutesFromRouterFile(routerContent ?? null);
    if (directRoutes.length > 0) {
      setImportedRoutes([]);
      return;
    }
    const routeFiles = findRouteFiles(app.files);
    if (routeFiles.length === 0) {
      setImportedRoutes([]);
      return;
    }
    Promise.all(
      routeFiles.map((filePath) =>
        ipc.app.readAppFile({ appId, filePath }).catch(() => null),
      ),
    ).then((contents) => {
      const discovered: ParsedRoute[] = [];
      for (const content of contents) {
        if (!content) continue;
        const fileRoutes = parseRoutesFromRouterFile(content);
        for (const route of fileRoutes) {
          if (!discovered.some((r) => r.path === route.path)) {
            discovered.push(route);
          }
        }
      }
      setImportedRoutes(discovered);
    });
  }, [appId, isNextApp, app?.files, routerContent]);

  // Parse routes either from Next.js file-based routing or from router file
  useEffect(() => {
    if (isNextApp && app?.files) {
      setRoutes(parseRoutesFromNextFiles(app.files));
    } else {
      const directRoutes = parseRoutesFromRouterFile(routerContent ?? null);
      setRoutes(mergeRoutes(directRoutes, importedRoutes));
    }
  }, [isNextApp, app?.files, routerContent, importedRoutes]);

  const combinedLoading = appLoading || routerFileLoading;
  const combinedError = appError || routerFileError || null;
  const refresh = async () => {
    await Promise.allSettled([refreshApp(), refreshFile()]);
  };

  return {
    routes,
    loading: combinedLoading,
    error: combinedError,
    refreshFile: refresh,
  };
}
