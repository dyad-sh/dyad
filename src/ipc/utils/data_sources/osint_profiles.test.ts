import { describe, expect, it, vi } from "vitest";

import { buildOsintProfilesPresentation } from "./osint_profiles";
import type { SchemaCatalogue } from "@/lib/data_sources/query_plan";

const catalogue: SchemaCatalogue = {
  tables: [
    {
      schemaName: "main",
      tableName: "people",
      columns: [
        { columnName: "id", dataType: "integer", primaryKey: true },
        { columnName: "full_name", dataType: "text" },
        { columnName: "nationality", dataType: "text" },
        { columnName: "notes", dataType: "text" },
      ],
    },
    {
      schemaName: "main",
      tableName: "person_evidence",
      columns: [
        { columnName: "id", dataType: "integer", primaryKey: true },
        { columnName: "person_id", dataType: "integer" },
        { columnName: "evidence_item_id", dataType: "integer" },
        { columnName: "relationship", dataType: "text" },
      ],
    },
    {
      schemaName: "main",
      tableName: "evidence_items",
      columns: [
        { columnName: "id", dataType: "integer", primaryKey: true },
        { columnName: "title", dataType: "text" },
        { columnName: "item_type", dataType: "text" },
        { columnName: "storage_url", dataType: "text" },
        { columnName: "storage_key", dataType: "text" },
        { columnName: "mime_type", dataType: "text" },
      ],
    },
  ],
  relationships: [],
};

describe("buildOsintProfilesPresentation", () => {
  it("combines a person with linked image evidence", async () => {
    const query = vi.fn(async (plan: { table: string }) =>
      plan.table === "person_evidence"
        ? [
            {
              id: 4,
              person_id: 1,
              evidence_item_id: 7,
              relationship: "profile_image",
            },
          ]
        : [
            {
              id: 7,
              title: "Bruce Wayne portrait",
              item_type: "image",
              storage_url: "local://uploads/bruce.jpg",
              storage_key: "Media/Images/Records/bruce.jpg",
              mime_type: "image/jpeg",
            },
          ],
    );

    const result = await buildOsintProfilesPresentation({
      sourceName: "osintstore",
      table: "people",
      rows: [
        {
          id: 1,
          full_name: "Bruce Wayne",
          nationality: "US",
          notes: "Fictional QA record",
        },
      ],
      catalogue,
      executionMs: 12,
      query,
    });

    expect(result?.kind).toBe("osint-profiles");
    expect(result?.records[0]).toMatchObject({
      id: "1",
      entityType: "person",
      name: "Bruce Wayne",
      imageUrl: "dyad-media://vault/Media%2FImages%2FRecords%2Fbruce.jpg",
      description: "Fictional QA record",
    });
    expect(result?.records[0].evidence[0]).toMatchObject({
      title: "Bruce Wayne portrait",
      relationship: "profile_image",
      storageKey: "Media/Images/Records/bruce.jpg",
      mimeType: "image/jpeg",
    });
    expect(result?.records[0].fields).toContainEqual({
      label: "Nationality",
      value: "US",
    });
  });

  it("returns null for ordinary business tables", async () => {
    expect(
      await buildOsintProfilesPresentation({
        sourceName: "shop",
        table: "orders",
        rows: [{ id: 1 }],
        catalogue: { tables: [], relationships: [] },
        query: vi.fn(),
      }),
    ).toBeNull();
  });

  it("uses a generic record image and preserves entered profile details", async () => {
    const result = await buildOsintProfilesPresentation({
      sourceName: "osintstore",
      table: "people",
      rows: [
        {
          id: 2,
          full_name: "Selina Kyle",
          occupation: "Antiquities dealer",
          date_of_birth: "1990-03-14",
          aliases: "Catwoman",
          images: JSON.stringify([
            { url: "https://assets.example.test/selina.jpg" },
          ]),
        },
      ],
      catalogue,
      query: vi.fn(async () => []),
    });

    expect(result?.records[0]).toMatchObject({
      name: "Selina Kyle",
      subtitle: "Antiquities dealer",
      imageUrl: "https://assets.example.test/selina.jpg",
    });
    expect(result?.records[0].fields).toEqual(
      expect.arrayContaining([
        { label: "Date Of Birth", value: "1990-03-14" },
        { label: "Aliases", value: "Catwoman" },
      ]),
    );
    expect(result?.records[0].fields).not.toContainEqual(
      expect.objectContaining({ label: "Images" }),
    );
  });
});
