import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DyadStateIndicator } from "./DyadCardPrimitives";

describe("DyadStateIndicator", () => {
  it("renders warning state with an amber indicator", () => {
    const { container } = render(
      <DyadStateIndicator state="warning" warningLabel="Needs attention" />,
    );

    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(container.querySelector(".text-amber-600")).toBeTruthy();
  });
});
