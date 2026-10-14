import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import home from "@/i18n/locales/en/home.json";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PreviewAppDomainsBanner,
  PreviewAppDomainsMenuItem,
} from "./PreviewAppDomains";

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown> | null,
  updateSettings: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({ useSettings: () => mocks }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key.split(".").reduce((value: any, part) => value?.[part], home) ?? key,
  }),
}));

beforeEach(() => {
  mocks.settings = {};
  mocks.updateSettings.mockReset().mockResolvedValue(undefined);
});

async function openMenu(disabled = false) {
  const onRestart = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DropdownMenu>
        <DropdownMenuTrigger>More options</DropdownMenuTrigger>
        <DropdownMenuContent>
          <PreviewAppDomainsMenuItem
            onRestart={onRestart}
            disabled={disabled}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "More options" }));
  const toggle = screen.getByRole("menuitemcheckbox", {
    name: "App-specific domains",
  });
  return { user, toggle, onRestart };
}

describe("preview domains menu switch", () => {
  it.each([undefined, false, true])(
    "displays preference %s and restarts only after the change is saved",
    async (enabled) => {
      mocks.settings = { enableAppPreviewDomains: enabled };
      let finishSave!: () => void;
      mocks.updateSettings.mockReturnValue(
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
      );
      const { user, toggle, onRestart } = await openMenu();
      expect(toggle).toHaveAttribute("aria-checked", String(enabled ?? true));
      await user.click(toggle);
      await waitFor(() =>
        expect(mocks.updateSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            enableAppPreviewDomains: !(enabled ?? true),
          }),
        ),
      );
      expect(onRestart).not.toHaveBeenCalled();
      expect(toggle).toHaveAttribute("aria-disabled", "true");
      await user.click(toggle);
      expect(mocks.updateSettings).toHaveBeenCalledOnce();
      await act(async () => finishSave());
      await waitFor(() => expect(onRestart).toHaveBeenCalledOnce());
    },
  );

  it("shows a previously dismissed banner when app domains are enabled again", async () => {
    mocks.settings = {
      enableAppPreviewDomains: false,
      hideAppPreviewDomainsBanner: true,
    };
    const { user, toggle, onRestart } = await openMenu();
    await user.click(toggle);
    await waitFor(() => expect(onRestart).toHaveBeenCalledOnce());
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      enableAppPreviewDomains: true,
      hideAppPreviewDomainsBanner: false,
    });
  });

  it("keeps the current preview when saving fails and allows retry", async () => {
    mocks.updateSettings.mockRejectedValueOnce(new Error("Save failed"));
    const { user, toggle, onRestart } = await openMenu();
    await user.click(toggle);
    await waitFor(() =>
      expect(toggle).not.toHaveAttribute("aria-disabled", "true"),
    );
    expect(onRestart).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);
    await waitFor(() => expect(onRestart).toHaveBeenCalledOnce());
  });

  it.each(["settings-loading", "runtime-busy"])(
    "blocks changes while %s",
    async (reason) => {
      if (reason === "settings-loading") mocks.settings = null;
      const { user, toggle, onRestart } = await openMenu(
        reason === "runtime-busy",
      );
      expect(toggle).toHaveAttribute("aria-disabled", "true");
      await user.click(toggle);
      expect(mocks.updateSettings).not.toHaveBeenCalled();
      expect(onRestart).not.toHaveBeenCalled();
    },
  );

  it("supports keyboard activation", async () => {
    const { user, toggle, onRestart } = await openMenu();
    toggle.focus();
    await user.keyboard(" ");
    await waitFor(() => expect(onRestart).toHaveBeenCalledOnce());
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      enableAppPreviewDomains: false,
    });
  });
});

describe("preview domains banner", () => {
  function renderBanner() {
    const client = new QueryClient();
    const tree = () => (
      <QueryClientProvider client={client}>
        <PreviewAppDomainsBanner />
      </QueryClientProvider>
    );
    const view = render(tree());
    return { ...view, rerenderBanner: () => view.rerender(tree()) };
  }

  it("explains the OAuth fallback and remembers dismissal", async () => {
    const user = userEvent.setup();
    const view = renderBanner();
    expect(screen.getByRole("status")).toHaveTextContent(
      home.preview.appDomains.banner,
    );
    await user.click(
      screen.getByRole("button", { name: "Dismiss app domains notice" }),
    );
    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        hideAppPreviewDomainsBanner: true,
      }),
    );
    mocks.settings = { hideAppPreviewDomainsBanner: true };
    view.rerenderBanner();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    view.unmount();
    renderBanner();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    null,
    { enableAppPreviewDomains: false },
    { hideAppPreviewDomainsBanner: true },
  ])("does not show the notice for settings %j", (settings) => {
    mocks.settings = settings;
    renderBanner();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
