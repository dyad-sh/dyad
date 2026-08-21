import type { ChatAgentToolPresentation } from "@/ipc/types/chat_agent";
import type { QueryPlan, SchemaCatalogue } from "@/lib/data_sources/query_plan";
import { formatCell } from "@/lib/data_sources/result_table";
import { buildVaultMediaUrl } from "../vault_media";

type EntityType = "person" | "company" | "entity";
type Row = Record<string, unknown>;
type Presentation = Extract<
  ChatAgentToolPresentation,
  { kind: "osint-profiles" }
>;

const TABLE_TYPES: Array<{
  pattern: RegExp;
  type: EntityType;
  singular: string;
}> = [
  {
    pattern: /^(people|persons|person|individuals)$/i,
    type: "person",
    singular: "person",
  },
  {
    pattern: /^(companies|company|organisations|organizations|businesses)$/i,
    type: "company",
    singular: "company",
  },
  { pattern: /^(entities|entity)$/i, type: "entity", singular: "entity" },
];

const NAME_KEYS = ["full_name", "display_name", "legal_name", "name", "title"];
const DESCRIPTION_KEYS = [
  "bio",
  "biography",
  "summary",
  "description",
  "notes",
];
const IMAGE_KEYS = [
  "profile_image_url",
  "profile_image",
  "image_url",
  "image",
  "images",
  "photo_url",
  "photo",
  "photos",
  "avatar_url",
  "avatar",
  "portrait_url",
  "portrait",
  "thumbnail_url",
  "thumbnail",
  "storage_url",
];
const MEDIA_FIELD_PATTERN =
  /(?:^|_)(?:profile_)?(?:image|images|photo|photos|avatar|portrait|thumbnail|media)(?:_|$)/i;
const HIDDEN_FIELD_KEYS = new Set([
  "id",
  ...NAME_KEYS,
  ...DESCRIPTION_KEYS,
  ...IMAGE_KEYS,
  "created_at",
  "updated_at",
]);

function value(row: Row, keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = row[key];
    if (raw !== null && raw !== undefined && String(raw).trim()) {
      return formatCell(raw);
    }
  }
  return undefined;
}

function humanLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stringId(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw);
}

function isImageEvidence(row: Row): boolean {
  return (
    String(row.mime_type ?? "").startsWith("image/") ||
    /^image$/i.test(String(row.item_type ?? row.type ?? ""))
  );
}

function mediaStrings(raw: unknown): string[] {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (/^[[{]/.test(trimmed)) {
      try {
        return mediaStrings(JSON.parse(trimmed));
      } catch {
        // A URL may legitimately contain brackets, so retain the original.
      }
    }
    return [trimmed];
  }
  if (Array.isArray(raw)) return raw.flatMap(mediaStrings);
  if (raw && typeof raw === "object") {
    const object = raw as Row;
    return [
      object.storage_key,
      object.storage_url,
      object.url,
      object.src,
      object.path,
    ].flatMap(mediaStrings);
  }
  return [];
}

function asRenderableMediaUrl(candidate: string): string | undefined {
  if (/^Media\//i.test(candidate)) return buildVaultMediaUrl(candidate);
  return /^(dyad-media|https?|data):/i.test(candidate) ? candidate : undefined;
}

function renderableMediaUrl(
  row: Row,
  includeSourceUrl = false,
): string | undefined {
  const storageKey = value(row, ["storage_key"]);
  if (storageKey && /^Media\//i.test(storageKey)) {
    return buildVaultMediaUrl(storageKey);
  }

  const candidateValues = [
    ...IMAGE_KEYS.map((key) => row[key]),
    ...Object.entries(row)
      .filter(([key]) => MEDIA_FIELD_PATTERN.test(key))
      .map(([, raw]) => raw),
    ...(includeSourceUrl ? [row.source_url, row.url] : []),
  ];
  for (const candidate of candidateValues.flatMap(mediaStrings)) {
    const url = asRenderableMediaUrl(candidate);
    if (url) return url;
  }
  return undefined;
}

/**
 * Turns conventional OSINT people/company/entity tables into rich profiles.
 * Evidence enrichment is best-effort: unfamiliar schemas still get a profile
 * card from the core row instead of falling back to a spreadsheet.
 */
export async function buildOsintProfilesPresentation(input: {
  sourceName: string;
  table: string;
  rows: unknown[];
  catalogue: SchemaCatalogue;
  executionMs?: number;
  query: (plan: QueryPlan) => Promise<Row[]>;
}): Promise<Presentation | null> {
  const match = TABLE_TYPES.find(({ pattern }) => pattern.test(input.table));
  if (!match) return null;
  const coreRows = input.rows.filter(
    (row): row is Row =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
  if (coreRows.length === 0) return null;

  const baseTable = input.catalogue.tables.find(
    (table) => table.tableName === input.table,
  );
  const idKey =
    baseTable?.columns.find((column) => column.primaryKey)?.columnName ?? "id";
  const ids = coreRows.map((row) => stringId(row[idKey])).filter(Boolean);

  let links: Row[] = [];
  let evidenceRows: Row[] = [];
  const junctionName = `${match.singular}_evidence`;
  const junction = input.catalogue.tables.find(
    (table) => table.tableName.toLowerCase() === junctionName,
  );
  const evidence = input.catalogue.tables.find((table) =>
    /^(evidence_items|evidence)$/i.test(table.tableName),
  );
  const entityIdKey = `${match.singular}_id`;
  const evidenceIdKey =
    junction?.columns.find((column) => /evidence.*_id/i.test(column.columnName))
      ?.columnName ?? "evidence_item_id";
  const evidencePrimaryKey =
    evidence?.columns.find((column) => column.primaryKey)?.columnName ?? "id";

  if (
    ids.length > 0 &&
    junction?.columns.some((column) => column.columnName === entityIdKey) &&
    evidence
  ) {
    try {
      links = await input.query({
        table: junction.tableName,
        filters: [{ column: entityIdKey, operator: "in", value: ids }],
        limit: 100,
      });
      const evidenceIds = links
        .map((row) => stringId(row[evidenceIdKey]))
        .filter(Boolean);
      if (evidenceIds.length > 0) {
        evidenceRows = await input.query({
          table: evidence.tableName,
          filters: [
            {
              column: evidencePrimaryKey,
              operator: "in",
              value: evidenceIds,
            },
          ],
          limit: 100,
        });
      }
    } catch {
      // The profile itself remains useful when evidence permissions are tighter
      // than the base table or a provider cannot express this enrichment.
    }
  }

  const evidenceById = new Map(
    evidenceRows.map((row) => [stringId(row[evidencePrimaryKey]), row]),
  );

  return {
    kind: "osint-profiles",
    sourceName: input.sourceName,
    table: input.table,
    executionMs: input.executionMs,
    records: coreRows.map((row) => {
      const id = stringId(row[idKey]);
      const recordLinks = links.filter(
        (link) => stringId(link[entityIdKey]) === id,
      );
      const linkedEvidence = recordLinks.flatMap((link) => {
        const item = evidenceById.get(stringId(link[evidenceIdKey]));
        return item ? [{ link, item }] : [];
      });
      const profileImage = linkedEvidence.find(({ item }) =>
        isImageEvidence(item),
      )?.item;
      const subtitle =
        value(row, ["occupation", "role", "industry", "entity_type", "type"]) ??
        value(row, ["nationality", "jurisdiction", "country"]);

      return {
        id,
        entityType: match.type,
        name: value(row, NAME_KEYS) ?? `${humanLabel(match.type)} ${id}`,
        subtitle,
        description: value(row, DESCRIPTION_KEYS),
        imageUrl:
          renderableMediaUrl(row) ?? renderableMediaUrl(profileImage ?? {}),
        fields: Object.entries(row)
          .filter(
            ([key, raw]) =>
              !HIDDEN_FIELD_KEYS.has(key) &&
              !MEDIA_FIELD_PATTERN.test(key) &&
              raw !== null &&
              raw !== undefined &&
              String(raw).trim() !== "",
          )
          .slice(0, 12)
          .map(([key, raw]) => ({
            label: humanLabel(key),
            value: formatCell(raw),
          })),
        evidence: linkedEvidence.slice(0, 12).map(({ link, item }) => ({
          id: stringId(item[evidencePrimaryKey]),
          title: value(item, ["title", "name"]) ?? "Untitled evidence",
          itemType: value(item, ["item_type", "type"]),
          relationship: value(link, ["relationship", "relation_type"]),
          url: renderableMediaUrl(item, isImageEvidence(item)),
          sourceUrl: value(item, ["source_url", "url"]),
          storageKey: value(item, ["storage_key"]),
          mimeType: value(item, ["mime_type"]),
        })),
      };
    }),
  };
}
