import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DyadDbTableSchema } from "./DyadDbTableSchema";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => {
      const map: Record<string, string> = {
        "integrations.db.tableSchema": "Table Schema",
        "integrations.db.tableSchemaProvider": `${opts?.provider} Table Schema`,
        "integrations.db.fetching": "Fetching...",
        "integrations.db.didNotFinish": "Did not finish",
      };
      return map[key] ?? key;
    },
  }),
}));

describe("DyadDbTableSchema", () => {
  it("uses the generic badge label when a table name is present", () => {
    render(
      <DyadDbTableSchema
        provider="Supabase"
        node={{ properties: { table: "users" } }}
      >
        schema
      </DyadDbTableSchema>,
    );

    expect(screen.getByText("Table Schema")).toBeTruthy();
    expect(screen.queryByText("Supabase Table Schema")).toBeNull();
    expect(screen.getByText("users")).toBeTruthy();
  });

  it("keeps the provider-specific badge when no table name is present", () => {
    render(
      <DyadDbTableSchema provider="Neon" node={{ properties: {} }}>
        schema
      </DyadDbTableSchema>,
    );

    expect(screen.getByText("Neon Table Schema")).toBeTruthy();
  });
});
