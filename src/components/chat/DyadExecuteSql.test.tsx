import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DyadExecuteSql } from "./DyadExecuteSql";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        changesDatabaseSchema: "Changes database schema",
        destructiveDataChange: "Destructive data change",
      })[key] ?? key,
  }),
}));

describe("DyadExecuteSql", () => {
  it("shows a schema mutation indicator for DDL", () => {
    render(<DyadExecuteSql>CREATE TABLE users (id bigint);</DyadExecuteSql>);

    expect(screen.getByText("Changes database schema")).toBeTruthy();
  });

  it("extracts SQL text from string children mixed with React nodes", () => {
    render(
      <DyadExecuteSql>
        {"CREATE "}
        <span>ignored</span>
        {"TABLE users (id bigint);"}
      </DyadExecuteSql>,
    );

    expect(screen.getByText("Changes database schema")).toBeTruthy();
  });

  it("omits the schema mutation indicator for ordinary queries", () => {
    render(<DyadExecuteSql>SELECT * FROM users;</DyadExecuteSql>);

    expect(screen.queryByText("Changes database schema")).toBeNull();
  });

  it("shows a destructive data indicator for deletes", () => {
    render(<DyadExecuteSql>DELETE FROM users WHERE id = 1;</DyadExecuteSql>);

    expect(screen.getByText("Destructive data change")).toBeTruthy();
  });
});
