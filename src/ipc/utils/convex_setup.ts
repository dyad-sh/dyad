const CONVEX_SCRIPT_ENTRIES = {
  "dev:backend": "convex dev",
  "convex:dev": "convex dev",
  "convex:deploy": "convex deploy",
} as const;

const CONVEX_DEPENDENCY_ENTRIES = {
  convex: "^1.31.2",
  "@convex-dev/auth": "^0.0.80",
} as const;

function ensureObjectRecord(
  value: unknown,
  fieldName: string,
): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid package.json: "${fieldName}" must be an object`);
  }
  const entries = Object.entries(value);
  for (const [key, fieldValue] of entries) {
    if (typeof fieldValue !== "string") {
      throw new Error(
        `Invalid package.json: "${fieldName}.${key}" must be a string`,
      );
    }
  }
  return value as Record<string, string>;
}

export function isConvexConfigured(paths: string[]): boolean {
  return paths.some((path) => path === "convex" || path.startsWith("convex/"));
}

export function addConvexToPackageJsonContent(packageJsonContent: string): {
  content: string;
  changed: boolean;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonContent);
  } catch (error) {
    throw new Error(`Invalid package.json JSON: ${error}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Invalid package.json: top-level JSON must be an object");
  }

  const packageJson = parsed as Record<string, unknown>;
  const scripts = ensureObjectRecord(packageJson.scripts, "scripts");
  const dependencies = ensureObjectRecord(
    packageJson.dependencies,
    "dependencies",
  );

  let changed = false;
  for (const [scriptName, scriptValue] of Object.entries(
    CONVEX_SCRIPT_ENTRIES,
  )) {
    if (!scripts[scriptName]) {
      scripts[scriptName] = scriptValue;
      changed = true;
    }
  }

  for (const [dependencyName, dependencyVersion] of Object.entries(
    CONVEX_DEPENDENCY_ENTRIES,
  )) {
    if (!dependencies[dependencyName]) {
      dependencies[dependencyName] = dependencyVersion;
      changed = true;
    }
  }

  packageJson.scripts = scripts;
  packageJson.dependencies = dependencies;

  return {
    content: JSON.stringify(packageJson, null, 2) + "\n",
    changed,
  };
}
