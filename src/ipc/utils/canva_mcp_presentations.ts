import type { ChatAgentToolPresentation } from "../types/chat_agent";

type UnknownRecord = Record<string, unknown>;
type CanvaDesignsPresentation = Extract<
  ChatAgentToolPresentation,
  { kind: "canva-designs" }
>;

const DESIGN_TOOL_NAMES = new Set([
  "search-designs",
  "search_designs",
  "get-design",
  "get_design",
  "generate-design",
  "generate_design",
  "create-design-from-candidate",
  "create_design_from_candidate",
  "copy-design",
  "copy_design",
  "get-design-thumbnail",
  "get_design_thumbnail",
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
  return record;
}

function mcpTextContent(record: UnknownRecord | null) {
  if (!Array.isArray(record?.content)) return undefined;
  const text = record.content
    .map((part) => {
      const item = asRecord(part);
      return typeof item?.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  return text || undefined;
}

function firstString(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function firstUrl(record: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const direct = record[key];
    const value =
      typeof direct === "string"
        ? direct
        : asRecord(direct)
          ? firstString(asRecord(direct)!, ["url", "href", "src"])
          : undefined;
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return parsed.toString();
      }
    } catch {
      // Ignore partial links from provider prose.
    }
  }
  return undefined;
}

function nestedUrl(record: UnknownRecord, parent: string, keys: string[]) {
  const nested = asRecord(record[parent]);
  return nested ? firstUrl(nested, keys) : undefined;
}

function candidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of [
    "designs",
    "generated_designs",
    "generatedDesigns",
    "candidates",
    "items",
    "results",
  ]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  const job = asRecord(record.job);
  if (job) {
    const nested = candidates(job.result ?? job);
    if (nested.length > 0) return nested;
  }
  const summary = asRecord(record.design_summary ?? record.designSummary);
  if (summary) return [summary];
  const data = parseJson(record.data);
  if (data !== record) {
    const nested = candidates(data);
    if (nested.length > 0) return nested;
  }
  return [record];
}

function normalizeDesign(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  const id = firstString(record, [
    "id",
    "design_id",
    "designId",
    "candidate_id",
    "candidateId",
  ]);
  const title =
    firstString(record, ["title", "name", "description", "prompt"]) ??
    (id ? `Canva design ${id.slice(0, 8)}` : undefined);
  if (!id || !title) return null;
  const urls = asRecord(record.urls);
  const editUrl =
    firstUrl(record, ["edit_url", "editUrl"]) ??
    (urls ? firstUrl(urls, ["edit_url", "editUrl", "edit"]) : undefined);
  const viewUrl =
    firstUrl(record, ["view_url", "viewUrl", "url"]) ??
    (urls ? firstUrl(urls, ["view_url", "viewUrl", "view"]) : undefined);
  const thumbnailUrl =
    firstUrl(record, [
      "thumbnail_url",
      "thumbnailUrl",
      "thumbnail",
      "preview_url",
      "previewUrl",
      "image_url",
      "imageUrl",
    ]) ??
    nestedUrl(record, "thumbnail", ["url", "src"]) ??
    (Array.isArray(record.thumbnails)
      ? firstUrl(asRecord(record.thumbnails[0]) ?? {}, ["url", "src"])
      : undefined);
  const pageCountValue = record.page_count ?? record.pageCount;

  return {
    id,
    title,
    description: firstString(record, ["description", "prompt", "summary"]),
    thumbnailUrl,
    editUrl,
    viewUrl,
    designType: firstString(record, ["design_type", "designType", "type"]),
    pageCount:
      typeof pageCountValue === "number"
        ? pageCountValue
        : Array.isArray(record.pages)
          ? record.pages.length
          : undefined,
    updatedAt: firstString(record, [
      "updated_at",
      "updatedAt",
      "created_at",
      "createdAt",
    ]),
    candidate: "candidate_id" in record || "candidateId" in record,
  };
}

function heading(toolName: string, count: number) {
  if (/generate[-_]design/.test(toolName)) return "Choose a Canva design";
  if (/create[-_]design[-_]from[-_]candidate/.test(toolName)) {
    return "Canva design created";
  }
  if (/copy[-_]design/.test(toolName)) return "Canva design copied";
  if (/get[-_]design/.test(toolName)) return "Canva design";
  return `${count} Canva design${count === 1 ? "" : "s"}`;
}

export function buildCanvaToolPresentation(
  toolName: string,
  result: unknown,
): ChatAgentToolPresentation | undefined {
  if (!DESIGN_TOOL_NAMES.has(toolName)) return undefined;
  const rawPayload = parseJson(result);
  const rawRecord = asRecord(rawPayload);
  if (rawRecord?.isError === true) {
    const errorMeta =
      asRecord(rawRecord._errorMeta) ?? asRecord(rawRecord.error);
    return {
      kind: "canva-designs",
      toolName,
      heading: "Canva generation needs attention",
      status: "failed",
      errorCode: firstString(errorMeta ?? {}, [
        "code",
        "error_code",
        "errorCode",
      ]),
      errorMessage:
        mcpTextContent(rawRecord)
          ?.replace(/\n\s*\n[\s\S]*$/, "")
          .trim() ??
        firstString(errorMeta ?? {}, ["message", "reason", "detail"]),
      designs: [],
    };
  }
  const payload = unwrapMcpResult(result);
  const payloadRecord = asRecord(payload);
  const job = asRecord(payloadRecord?.job);
  const jobId = firstString(job ?? {}, ["id"]);
  const jobStatus = firstString(job ?? {}, ["status"]);
  const jobError =
    asRecord(job?.error) ??
    asRecord(asRecord(job?.result)?.error) ??
    asRecord(payloadRecord?.error);
  if (
    /generate[-_]design/.test(toolName) &&
    jobStatus &&
    /^(?:failed|failure|error)$/i.test(jobStatus)
  ) {
    return {
      kind: "canva-designs",
      toolName,
      heading: "Canva generation needs another try",
      ...(jobId ? { jobId } : {}),
      status: "failed",
      errorCode:
        firstString(jobError ?? {}, ["code", "error_code", "errorCode"]) ??
        firstString(job ?? {}, ["error_code", "errorCode"]),
      errorMessage:
        firstString(jobError ?? {}, [
          "message",
          "reason",
          "detail",
          "description",
          "error_message",
          "errorMessage",
        ]) ??
        (typeof job?.error === "string" ? job.error : undefined) ??
        firstString(job ?? {}, [
          "error_message",
          "errorMessage",
          "failure_reason",
          "failureReason",
        ]),
      designs: [],
    };
  }
  const designs = candidates(payload)
    .map(normalizeDesign)
    .filter((design): design is NonNullable<typeof design> => Boolean(design))
    .slice(0, 12);
  if (designs.length === 0) return undefined;
  return {
    kind: "canva-designs",
    toolName,
    heading: heading(toolName, designs.length),
    ...(jobId ? { jobId } : {}),
    status: "success",
    designs,
  };
}

export function buildCanvaFailureAssistantMessage(
  presentation: CanvaDesignsPresentation,
): string | undefined {
  if (presentation.status !== "failed" || presentation.retryable !== false) {
    return undefined;
  }

  if (presentation.errorCode === "quota_exceeded") {
    return "Canva rejected this request because the connected account has reached its AI generation quota. Open Canva to review your usage, or wait for the quota to reset before trying again.";
  }

  if (
    ["authentication_required", "forbidden"].includes(
      presentation.errorCode ?? "",
    )
  ) {
    return "Canva rejected this request because the connected account needs attention. Open Canva or reconnect it in Settings → Plugins → Canva before trying again.";
  }

  return "Canva accepted the request, but its design generator failed before returning any concepts. I stopped after two attempts to avoid consuming more generation credits; open Canva to continue or try again later.";
}
