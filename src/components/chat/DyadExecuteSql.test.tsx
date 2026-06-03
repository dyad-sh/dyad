import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DyadExecuteSql } from "./DyadExecuteSql";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        changesDatabaseSchema: "Changes database schema",
      })[key] ?? key,
  }),
}));

describe("DyadExecuteSql", () => {
  it("shows a schema mutation indicator for DDL", () => {
    render(<DyadExecuteSql>CREATE TABLE users (id bigint);</DyadExecuteSql>);

    expect(screen.getByText("Changes database schema")).toBeTruthy();
  });

  it("omits the schema mutation indicator for ordinary queries", () => {
    render(<DyadExecuteSql>SELECT * FROM users;</DyadExecuteSql>);

    expect(screen.queryByText("Changes database schema")).toBeNull();
  });
});
