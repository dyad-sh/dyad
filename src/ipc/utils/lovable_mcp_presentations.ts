import type { ChatAgentToolPresentation } from "../types/chat_agent";

type UnknownRecord = Record<string, unknown>;

const PROJECT_LIST_KEYS = [
  "projects",
  "items",
  "results",
  "templates",
  "library_projects",
  "libraryProjects",
] as const;

const PROJECT_TOOL_NAMES = new Set([
  "list_projects",
  "get_project",
  "create_project",
  "deploy_project",
  "remix_project",
  "list_template_projects",
  "list_library_projects",
]);

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function unwrapMcpResult(value: unknown): unknown {
  const parsed = parseJson(value);
  const record = asRecord(parsed);
  if (!record) return parsed;

  if (record.structuredContent != null) {
    return unwrapMcpResult(record.structuredContent);
  }

  if (Array.isArray(record.content)) {
    const text = record.content
      .map((part) => {
        const item = asRecord(part);
        return typeof item?.text === "string" ? item.text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return unwrapMcpResult(text);
  }

  if (record.data != null) {
    const data = parseJson(record.data);
    if (Array.isArray(data) || asRecord(data)) return data;
  }

  return record;
}

function firstString(
  record: UnknownRecord,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function nestedString(
  record: UnknownRecord,
  key: string,
  nestedKeys: readonly string[],
): string | undefined {
  const nested = asRecord(record[key]);
  return nested ? firstString(nested, nestedKeys) : undefined;
}

function firstUrl(
  record: UnknownRecord,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const direct = record[key];
    const value =
      typeof direct === "string"
        ? direct
        : asRecord(direct)
          ? firstString(asRecord(direct)!, ["url", "src", "href"])
          : undefined;
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
    } catch {
      // Ignore partial or non-web URLs from research-preview payloads.
    }
  }
  return undefined;
}

function candidateProjects(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of PROJECT_LIST_KEYS) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  const data = asRecord(record.data);
  if (data && data !== record) {
    const nested = candidateProjects(data);
    if (nested.length > 0) return nested;
  }
  return [record];
}

function normalizeProject(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;

  const id = firstString(record, ["id", "project_id", "projectId", "uuid"]);
  const editorUrl = firstUrl(record, ["editor_url", "editorUrl"]);
  const previewUrl = firstUrl(record, [
    "preview_url",
    "previewUrl",
    "sandbox_url",
    "sandboxUrl",
  ]);
  const publishedUrl = firstUrl(record, [
    "published_url",
    "publishedUrl",
    "live_url",
    "liveUrl",
    "deployment_url",
    "deploymentUrl",
  ]);
  const screenshotUrl = firstUrl(record, [
    "screenshot_url",
    "screenshotUrl",
    "screenshot",
    "thumbnail_url",
    "thumbnailUrl",
    "thumbnail",
    "image_url",
    "imageUrl",
  ]);
  const name =
    firstString(record, ["name", "title", "project_name", "projectName"]) ??
    firstString(record, ["description"]) ??
    (id ? `Project ${id.slice(0, 8)}` : undefined);

  if (!name || (!id && !editorUrl && !previewUrl && !publishedUrl)) {
    return null;
  }

  return {
    id: id ?? name,
    name,
    description: firstString(record, [
      "summary",
      "description",
      "prompt",
      "initial_message",
    ]),
    workspace:
      firstString(record, ["workspace_name", "workspaceName"]) ??
      nestedString(record, "workspace", ["name", "title"]),
    screenshotUrl,
    previewUrl,
    editorUrl,
    publishedUrl,
    status: firstString(record, [
      "status",
      "build_status",
      "buildStatus",
      "deployment_status",
      "deploymentStatus",
    ]),
    visibility: firstString(record, ["visibility", "access"]),
    updatedAt: firstString(record, [
      "updated_at",
      "updatedAt",
      "modified_at",
      "modifiedAt",
      "created_at",
      "createdAt",
    ]),
  };
}

function presentationHeading(toolName: string, count: number) {
  if (toolName === "list_template_projects") return "Lovable templates";
  if (toolName === "list_library_projects") return "Library projects";
  if (toolName === "create_project") return "Project created";
  if (toolName === "deploy_project") return "Project deployed";
  if (toolName === "remix_project") return "Project remixed";
  if (toolName === "get_project") return "Project details";
  return `${count} Lovable project${count === 1 ? "" : "s"}`;
}

export function buildLovableToolPresentation(
  toolName: string,
  result: unknown,
): ChatAgentToolPresentation | undefined {
  if (!PROJECT_TOOL_NAMES.has(toolName)) return undefined;
  const payload = unwrapMcpResult(result);
  const projects = candidateProjects(payload)
    .map(normalizeProject)
    .filter((project): project is NonNullable<typeof project> =>
      Boolean(project),
    )
    .slice(0, 12);
  if (projects.length === 0) return undefined;

  return {
    kind: "lovable-projects",
    toolName,
    heading: presentationHeading(toolName, projects.length),
    projects,
  };
}
