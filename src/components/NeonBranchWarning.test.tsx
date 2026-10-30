import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NeonBranchWarning } from "./NeonBranchWarning";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);

it.each(["deployment", "development"] as const)(
  "keeps the %s recovery action outside the warning live region",
  (usage) => {
    const onUseRecommended = vi.fn();
    render(
      <NeonBranchWarning usage={usage} onUseRecommended={onUseRecommended} />,
    );
    const group = screen.getByRole("group", {
      name: `integrations.neon.branchSafety.${usage}Title`,
    });
    const warning = within(group).getByRole("alert");
    expect(warning.textContent).toContain(
      `integrations.neon.branchSafety.${usage}Warning`,
    );
    expect(within(warning).queryByRole("button")).toBeNull();
    fireEvent.click(
      within(group).getByRole("button", {
        name: `integrations.neon.branchSafety.${usage}Recommended`,
      }),
    );
    expect(onUseRecommended).toHaveBeenCalledOnce();
  },
);
