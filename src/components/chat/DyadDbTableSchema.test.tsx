import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DyadDbTableSchema } from "./DyadDbTableSchema";

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
