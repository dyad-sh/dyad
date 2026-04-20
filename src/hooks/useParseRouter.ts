import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useLoadApp } from "@/hooks/useLoadApp";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export interface ParsedRoute {
  path: string;
  label: string;
}

const ROUTE_FILE_EXTENSIONS = new Set(["js", "jsx", "ts", "tsx"]);

function hasRouteFileExtension(filePath: string): boolean {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return extension !== undefined && ROUTE_FILE_EXTENSIONS.has(extension);
}

function isAppEntryFile(filePath: string): boolean {
  return /(?:^|\/)App\.(?:js|jsx|ts|tsx)$/i.test(filePath);
}

function isRouteModuleFile(filePath: string): boolean {
  if (!hasRouteFileExtension(filePath)) {
    return false;
  }

  return (
    /(?:^|\/)routes\/.+\.(?:js|jsx|ts|tsx)$/i.test(filePath) ||
    /(?:^|\/)[^/]*routes?\.(?:js|jsx|ts|tsx)$/i.test(filePath) ||
    /(?:^|\/)router\.(?:js|jsx|ts|tsx)$/i.test(filePath)
  );
}

export function getReactRouterCandidateFiles(files: string[]): string[] {
  const candidates = new Set<string>();

  for (const file of files) {
    if (!hasRouteFileExtension(file)) {
      continue;
    }

    if (isAppEntryFile(file) || isRouteModuleFile(file)) {
      candidates.add(file);
    }
  }

  if (files.includes("src/App.tsx")) {
    candidates.delete("src/App.tsx");
    return ["src/App.tsx", ...Array.from(candidates)];
  }

  if (files.includes("App.tsx")) {
    candidates.delete("App.tsx");
    return ["App.tsx", ...Array.from(candidates)];
  }

  return Array.from(candidates);
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

export function parseRoutesFromRouterFiles(
  contents: Array<string | null | undefined>,
): ParsedRoute[] {
  const parsedRoutes: ParsedRoute[] = [];

  for (const content of contents) {
    for (const route of parseRoutesFromRouterFile(content ?? null)) {
      if (
        !parsedRoutes.some((existingRoute) => existingRoute.path === route.path)
      ) {
        parsedRoutes.push(route);
      }
    }
  }

  return parsedRoutes;
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
 */
export function useParseRouter(appId: number | null) {
  // Load app to access the file list
  const {
    app,
    loading: appLoading,
    error: appError,
    refreshApp,
  } = useLoadApp(appId);

  // Detect Next.js app by presence of next.config.* in file list
  const isNextApp = useMemo(() => {
    if (!app?.files) return false;
    return app.files.some((f) => f.toLowerCase().includes("next.config"));
  }, [app?.files]);

  const candidateRouterFiles = useMemo(() => {
    if (!app?.files || isNextApp) {
      return [];
    }

    return getReactRouterCandidateFiles(app.files);
  }, [app?.files, isNextApp]);

  const routerFileQueries = useQueries({
    queries: candidateRouterFiles.map((filePath) => ({
      queryKey: queryKeys.appFiles.content({ appId, filePath }),
      queryFn: async () => {
        return ipc.app.readAppFile({ appId: appId!, filePath });
      },
      enabled: appId !== null,
    })),
  });

  const routes =
    isNextApp && app?.files
      ? parseRoutesFromNextFiles(app.files)
      : parseRoutesFromRouterFiles(
          routerFileQueries.map((query) => query.data ?? null),
        );

  const routerFileLoading =
    !isNextApp &&
    candidateRouterFiles.length > 0 &&
    routerFileQueries.some((query) => query.isLoading);
  const routerFileError = !isNextApp
    ? (routerFileQueries.find((query) => query.error)?.error ?? null)
    : null;
  const combinedLoading = appLoading || routerFileLoading;
  const combinedError = appError || routerFileError || null;
  const refresh = async () => {
    await Promise.allSettled([
      refreshApp(),
      ...routerFileQueries.map(async (query) => {
        await query.refetch();
      }),
    ]);
  };

  return {
    routes,
    loading: combinedLoading,
    error: combinedError,
    refreshFile: refresh,
  };
}
