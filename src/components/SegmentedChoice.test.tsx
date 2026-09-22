import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedChoice } from "./SegmentedChoice";

describe("SegmentedChoice", () => {
  const options = [
    { value: "github" as const, label: "GitHub" },
    { value: "gitlab" as const, label: "GitLab" },
  ];

  it("tells assistive technology which side is selected", () => {
    // The selection decides the entire form rendered below the control, and
    // a background colour alone does not reach a screen reader, high
    // contrast, or forced colors.
    render(
      <SegmentedChoice
        ariaLabel="Repository provider"
        value="gitlab"
        onChange={() => {}}
        options={options}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "GitHub" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "GitLab" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("group", { name: "Repository provider" }),
    ).toBeTruthy();
  });

  it("reports the value that was chosen", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedChoice
        ariaLabel="Repository provider"
        value="github"
        onChange={onChange}
        options={options}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "GitLab" }));

    expect(onChange).toHaveBeenCalledWith("gitlab");
  });
});
