import { useMemo } from "react";
import { parse } from "@babel/parser";
import type * as t from "@babel/types";
import { useQueries } from "@tanstack/react-query";
import { useLoadApp } from "@/hooks/useLoadApp";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export interface ParsedRoute {
  path: string;
  label: string;
}

const ROUTE_FILE_EXTENSIONS = new Set(["js", "jsx", "ts", "tsx"]);
const ASTRO_PAGE_FILE_EXTENSIONS = new Set(["astro", "html", "md", "mdx"]);
const TANSTACK_ESCAPED_DOT_SENTINEL = "\0";
const TANSTACK_ROUTE_FILE_SEGMENTS = new Set([
  "route",
  "lazy",
  "component",
  "errorComponent",
  "pendingComponent",
  "loader",
]);

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

/** Vue applications commonly keep their router in src/router/index.ts. */
export function getVueRouterCandidateFiles(files: string[]): string[] {
  return files.filter((file) =>
    /(?:^|\/)(?:router\/[^/]+|main)\.(?:js|ts)$/i.test(file),
  );
}

/** Read literal Vue Router records without importing or executing app code. */
export function parseRoutesFromVueRouterFile(content: string): ParsedRoute[] {
  if (!content.includes("vue-router")) return [];
  try {
    const ast = parse(content, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
    const factories = new Set<string>();
    const bindings = new Map<string, t.Expression>();
    for (const statement of ast.program.body) {
      if (
        statement.type === "ImportDeclaration" &&
        statement.source.value === "vue-router"
      ) {
        for (const specifier of statement.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "createRouter"
          ) {
            factories.add(specifier.local.name);
          }
        }
      }
      const declaration =
        statement.type === "ExportNamedDeclaration"
          ? statement.declaration
          : statement;
      if (declaration?.type === "VariableDeclaration") {
        for (const variable of declaration.declarations) {
          if (variable.id.type === "Identifier" && variable.init) {
            bindings.set(variable.id.name, variable.init);
          }
        }
      }
    }
    if (factories.size === 0) return [];

    function resolve(
      node: t.Node | null | undefined,
      seen = new Set<string>(),
    ): t.Node | undefined {
      if (!node) return undefined;
      if (
        node.type === "TSAsExpression" ||
        node.type === "TSSatisfiesExpression" ||
        node.type === "ParenthesizedExpression"
      )
        return resolve(node.expression, seen);
      if (node.type !== "Identifier") return node;
      if (seen.has(node.name)) return undefined;
      seen.add(node.name);
      return resolve(bindings.get(node.name), seen);
    }
    function property(
      node: t.Node | undefined,
      name: string,
    ): t.Node | undefined {
      if (node?.type !== "ObjectExpression") return undefined;
      const prop = node.properties.find(
        (entry): entry is t.ObjectProperty =>
          entry.type === "ObjectProperty" &&
          !entry.computed &&
          ((entry.key.type === "Identifier" && entry.key.name === name) ||
            (entry.key.type === "StringLiteral" && entry.key.value === name)),
      );
      return resolve(prop?.value);
    }
    const paths = new Set<string>();
    function records(
      node: t.Node | undefined,
      parent: string,
      ancestors = new Set<t.Node>(),
    ) {
      node = resolve(node);
      if (node?.type !== "ArrayExpression" || ancestors.has(node)) return;
      const nextAncestors = new Set(ancestors).add(node);
      for (const element of node.elements) {
        const record = resolve(element);
        const value = property(record, "path");
        if (value?.type !== "StringLiteral") continue;
        // Wildcards and custom parameter regexes do not name navigable pages.
        if (/[()*]/.test(value.value)) continue;
        const path = value.value.startsWith("/")
          ? value.value
          : `${parent.replace(/\/$/, "")}/${value.value}`;
        const normalized = path.replace(/\/$/, "") || "/";
        paths.add(normalized);
        records(property(record, "children"), normalized, nextAncestors);
      }
    }
    function visit(node: t.Node) {
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        factories.has(node.callee.name)
      ) {
        records(property(resolve(node.arguments[0]), "routes"), "");
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const child of value)
            if (child && typeof child === "object" && "type" in child)
              visit(child as t.Node);
        } else if (value && typeof value === "object" && "type" in value)
          visit(value as t.Node);
      }
    }
    visit(ast.program);
    return Array.from(paths, (path) => ({
      path,
      label: buildRouteLabel(path),
    }));
  } catch {
    // Incomplete source while the app is being edited is not a router error.
    return [];
  }
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
    for (const route of [
      ...parseRoutesFromRouterFile(content ?? null),
      ...parseRoutesFromVueRouterFile(content ?? ""),
    ]) {
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
 * Parses routes from Astro file-based routing (src/pages directory).
 */
export function parseRoutesFromAstroFiles(files: string[]): ParsedRoute[] {
  const astroRoutes = new Set<string>();

  for (const file of files) {
    if (!file.startsWith("src/pages/")) continue;
    if (file.startsWith("src/pages/api/")) continue;

    const extension = file.split(".").pop()?.toLowerCase();
    if (!extension || !ASTRO_PAGE_FILE_EXTENSIONS.has(extension)) continue;

    let routePath = file
      .slice("src/pages/".length)
      .replace(/\.(?:astro|html|md|mdx)$/i, "");

    if (!routePath || routePath.includes("[")) continue;
    if (routePath.split("/").some((segment) => segment.startsWith("_"))) {
      continue;
    }

    if (routePath === "index") {
      astroRoutes.add("/");
      continue;
    }

    if (routePath.endsWith("/index")) {
      routePath = routePath.slice(0, -"/index".length);
    }

    astroRoutes.add("/" + routePath);
  }

  return Array.from(astroRoutes).map((path) => ({
    path,
    label: buildRouteLabel(path),
  }));
}

/**
 * Parses routes from TanStack Start / TanStack Router file-based routing.
 */
export function parseRoutesFromTanStackStartFiles(
  files: string[],
): ParsedRoute[] {
  const tanStackRoutes = new Set<string>();

  for (const file of files) {
    if (!file.startsWith("src/routes/")) continue;

    const extension = file.split(".").pop()?.toLowerCase();
    if (!extension || !ROUTE_FILE_EXTENSIONS.has(extension)) continue;

    let routePath = file.slice("src/routes/".length);
    if (
      routePath === "__root.tsx" ||
      routePath === "__root.jsx" ||
      routePath === "__root.ts" ||
      routePath === "__root.js"
    ) {
      continue;
    }

    routePath = routePath.replace(/\.(?:js|jsx|ts|tsx)$/i, "");

    if (!routePath || routePath.includes("$")) continue;

    const routeSegments = routePath.split("/").filter((segment) => segment);
    const rawSegments = routeSegments.flatMap((segment) =>
      segment
        .replaceAll("[.]", TANSTACK_ESCAPED_DOT_SENTINEL)
        .split(".")
        .filter((part) => part),
    );
    if (rawSegments.some((segment) => segment.startsWith("-"))) continue;

    const segments = routeSegments
      .flatMap((segment, index) => {
        const parts = segment
          .replaceAll("[.]", TANSTACK_ESCAPED_DOT_SENTINEL)
          .split(".")
          .filter((part) => part)
          .map((part) => part.replaceAll(TANSTACK_ESCAPED_DOT_SENTINEL, "."));
        if (
          parts[0] === "route" &&
          index === routeSegments.length - 1 &&
          parts.every(
            (part, partIndex) =>
              partIndex === 0 || TANSTACK_ROUTE_FILE_SEGMENTS.has(part),
          )
        ) {
          return [];
        }

        if (
          parts.length > 1 &&
          TANSTACK_ROUTE_FILE_SEGMENTS.has(parts[parts.length - 1])
        ) {
          return parts.slice(0, -1);
        }

        return parts;
      })
      .filter((segment) => !/^\(.+\)$/.test(segment))
      .filter((segment) => !segment.startsWith("_"))
      .map((segment) => segment.replace(/_$/, ""))
      .map((segment) => (segment === "index" ? "" : segment));

    if (
      segments.every((segment) => segment === "") &&
      rawSegments.some((segment) => segment === "index" || segment === "route")
    ) {
      tanStackRoutes.add("/");
      continue;
    }

    const cleaned = segments.filter(Boolean).join("/");
    if (cleaned) {
      tanStackRoutes.add("/" + cleaned);
    }
  }

  return Array.from(tanStackRoutes).map((path) => ({
    path,
    label: buildRouteLabel(path),
  }));
}

export function isTanStackStartAppFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower === "src/routetree.gen.ts" ||
    lower === "src/routetree.gen.js" ||
    lower === "src/routes/__root.tsx" ||
    lower === "src/routes/__root.jsx" ||
    lower === "src/routes/__root.ts" ||
    lower === "src/routes/__root.js"
  );
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

  const isAstroApp = useMemo(() => {
    if (!app?.files) return false;
    return app.files.some((f) => /^astro\.config\./i.test(f));
  }, [app?.files]);

  const isTanStackStartApp = useMemo(() => {
    if (!app?.files) return false;
    return app.files.some(isTanStackStartAppFile);
  }, [app?.files]);

  const candidateRouterFiles = useMemo(() => {
    if (!app?.files || isNextApp || isAstroApp || isTanStackStartApp) {
      return [];
    }

    return Array.from(
      new Set([
        ...getReactRouterCandidateFiles(app.files),
        ...getVueRouterCandidateFiles(app.files),
      ]),
    );
  }, [app?.files, isAstroApp, isNextApp, isTanStackStartApp]);

  const routerFileQueries = useQueries({
    queries: candidateRouterFiles.map((filePath) => ({
      queryKey: queryKeys.appFiles.content({ appId, filePath }),
      queryFn: async () => {
        return ipc.app.readAppFile({ appId: appId!, filePath });
      },
      enabled: appId !== null,
    })),
  });

  // Prefer more specific file-based routers before falling back to generic
  // React Router parsing when multiple framework signals are present.
  const routes =
    isNextApp && app?.files
      ? parseRoutesFromNextFiles(app.files)
      : isAstroApp && app?.files
        ? parseRoutesFromAstroFiles(app.files)
        : isTanStackStartApp && app?.files
          ? parseRoutesFromTanStackStartFiles(app.files)
          : parseRoutesFromRouterFiles(
              routerFileQueries.map((query) => query.data ?? null),
            );

  const routerFileLoading =
    !isNextApp &&
    !isAstroApp &&
    !isTanStackStartApp &&
    candidateRouterFiles.length > 0 &&
    routerFileQueries.some((query) => query.isLoading);
  const routerFileError =
    !isNextApp && !isAstroApp && !isTanStackStartApp
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
