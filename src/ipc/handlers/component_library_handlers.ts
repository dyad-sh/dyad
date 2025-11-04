import { ipcMain } from "electron";
import { db } from "../../db";
import { apps, componentLibraries, installedComponents } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { getDyadAppPath } from "@/paths/paths";
import { fileExists } from "../utils/file_utils";

const execPromise = promisify(exec);
const logger = log.scope("component_library_handlers");
const handle = createLoggedHandler(logger);

export type ComponentLibrary = "shadcn" | "mui" | "chakra" | "custom";

export interface InstallLibraryParams {
  appId: number;
  library: ComponentLibrary;
}

export interface InstallComponentParams {
  appId: number;
  libraryId: number;
  componentName: string;
}

// Shadcn/ui component registry
const SHADCN_COMPONENTS = [
  "accordion",
  "alert",
  "alert-dialog",
  "aspect-ratio",
  "avatar",
  "badge",
  "button",
  "calendar",
  "card",
  "checkbox",
  "collapsible",
  "command",
  "context-menu",
  "dialog",
  "dropdown-menu",
  "form",
  "hover-card",
  "input",
  "label",
  "menubar",
  "navigation-menu",
  "popover",
  "progress",
  "radio-group",
  "scroll-area",
  "select",
  "separator",
  "sheet",
  "skeleton",
  "slider",
  "switch",
  "table",
  "tabs",
  "textarea",
  "toast",
  "toggle",
  "tooltip",
];

/**
 * Install shadcn/ui library
 */
async function installShadcnUi(appPath: string): Promise<void> {
  logger.info("Installing shadcn/ui");

  // Check if already initialized
  const componentsJsonPath = path.join(appPath, "components.json");
  const alreadyInitialized = await fileExists(componentsJsonPath);

  if (!alreadyInitialized) {
    // Initialize shadcn/ui
    // This requires manual configuration, so we'll create a default components.json
    const componentsJson = {
      $schema: "https://ui.shadcn.com/schema.json",
      style: "default",
      rsc: false,
      tsx: true,
      tailwind: {
        config: "tailwind.config.js",
        css: "src/index.css",
        baseColor: "slate",
        cssVariables: true,
      },
      aliases: {
        components: "@/components",
        utils: "@/lib/utils",
      },
    };

    await fs.writeFile(
      componentsJsonPath,
      JSON.stringify(componentsJson, null, 2),
    );
  }

  // Install required dependencies
  const dependencies = [
    "class-variance-authority",
    "clsx",
    "tailwind-merge",
    "lucide-react",
  ];

  const { stdout, stderr } = await execPromise(
    `cd "${appPath}" && npm install ${dependencies.join(" ")}`,
  );

  logger.info("Shadcn/ui dependencies installed:", stdout);

  // Create lib/utils.ts if it doesn't exist
  const utilsPath = path.join(appPath, "src", "lib", "utils.ts");
  const utilsDir = path.dirname(utilsPath);

  try {
    await fs.access(utilsDir);
  } catch {
    await fs.mkdir(utilsDir, { recursive: true });
  }

  const utilsExists = await fileExists(utilsPath);
  if (!utilsExists) {
    const utilsContent = `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;
    await fs.writeFile(utilsPath, utilsContent);
  }
}

/**
 * Install component library
 */
handle("component-library:install", async (event, params: InstallLibraryParams) => {
  const { appId, library } = params;

  logger.info("Installing component library", { appId, library });

  // Get app
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  const appPath = getDyadAppPath(app.path);

  // Install library based on type
  if (library === "shadcn") {
    await installShadcnUi(appPath);
  } else {
    throw new Error(`Library ${library} not yet supported`);
  }

  // Record in database
  const [libraryRecord] = await db
    .insert(componentLibraries)
    .values({
      appId,
      library,
    })
    .returning();

  return libraryRecord;
});

/**
 * Install a specific component from shadcn/ui
 */
handle(
  "component-library:install-component",
  async (event, params: InstallComponentParams) => {
    const { appId, libraryId, componentName } = params;

    logger.info("Installing component", { appId, libraryId, componentName });

    // Get library
    const library = await db.query.componentLibraries.findFirst({
      where: eq(componentLibraries.id, libraryId),
    });

    if (!library) {
      throw new Error("Library not found");
    }

    // Get app
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    const appPath = getDyadAppPath(app.path);

    // Install component based on library
    if (library.library === "shadcn") {
      // Use npx shadcn-ui@latest add command
      const { stdout, stderr } = await execPromise(
        `cd "${appPath}" && npx shadcn@latest add ${componentName} --yes --overwrite`,
      );

      logger.info("Shadcn component installed:", stdout);
    } else {
      throw new Error(`Library ${library.library} not yet supported`);
    }

    // Record in database
    const [componentRecord] = await db
      .insert(installedComponents)
      .values({
        libraryId,
        componentName,
      })
      .returning();

    return componentRecord;
  },
);

/**
 * Get installed libraries for an app
 */
handle("component-library:get-libraries", async (event, appId: number) => {
  const libraries = await db.query.componentLibraries.findMany({
    where: eq(componentLibraries.appId, appId),
  });

  return libraries;
});

/**
 * Get installed components for a library
 */
handle("component-library:get-components", async (event, libraryId: number) => {
  const components = await db.query.installedComponents.findMany({
    where: eq(installedComponents.libraryId, libraryId),
  });

  return components;
});

/**
 * Get available components for a library
 */
handle("component-library:get-available-components", async (event, library: ComponentLibrary) => {
  if (library === "shadcn") {
    return SHADCN_COMPONENTS.map((name) => ({
      name,
      description: `Shadcn/ui ${name} component`,
    }));
  }

  return [];
});

/**
 * Delete library
 */
handle("component-library:delete", async (event, libraryId: number) => {
  await db.delete(componentLibraries).where(eq(componentLibraries.id, libraryId));
  return { success: true };
});

export function registerComponentLibraryHandlers() {
  logger.info("Component library handlers registered");
}
