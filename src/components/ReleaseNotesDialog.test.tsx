import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Settings = {
  lastShownReleaseNotesVersion?: string;
};

describe("ReleaseNotesDialog", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("shows release notes after an upgrade and records the shown version", async () => {
    const updateSettings = vi.fn();
    const doesReleaseNoteExist = vi.fn().mockResolvedValue({
      exists: true,
      url: "about:blank",
    });

    await renderReleaseNotesDialog({
      settings: { lastShownReleaseNotesVersion: "1.2.0" },
      updateSettings,
      doesReleaseNoteExist,
    });

    expect(await screen.findByText("What's new in v1.3.0?")).toBeTruthy();
    expect(doesReleaseNoteExist).toHaveBeenCalledWith({ version: "1.3.0" });
    expect(
      screen.getByTitle("Release notes for v1.3.0").getAttribute("sandbox"),
    ).toBe("allow-same-origin allow-scripts");
    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        lastShownReleaseNotesVersion: "1.3.0",
      });
    });
  });

  it("records the current version without fetching release notes on first run", async () => {
    const updateSettings = vi.fn();
    const doesReleaseNoteExist = vi.fn();

    await renderReleaseNotesDialog({
      settings: {},
      updateSettings,
      doesReleaseNoteExist,
    });

    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        lastShownReleaseNotesVersion: "1.3.0",
      });
    });
    expect(doesReleaseNoteExist).not.toHaveBeenCalled();
    expect(screen.queryByText("What's new in v1.3.0?")).toBeNull();
  });

  it("does not record the current version when no release note exists", async () => {
    const updateSettings = vi.fn();
    const doesReleaseNoteExist = vi.fn().mockResolvedValue({
      exists: false,
    });

    await renderReleaseNotesDialog({
      settings: { lastShownReleaseNotesVersion: "1.2.0" },
      updateSettings,
      doesReleaseNoteExist,
    });

    await waitFor(() => {
      expect(doesReleaseNoteExist).toHaveBeenCalledWith({ version: "1.3.0" });
    });
    expect(updateSettings).not.toHaveBeenCalled();
    expect(screen.queryByText("What's new in v1.3.0?")).toBeNull();
  });
});

async function renderReleaseNotesDialog({
  settings,
  updateSettings,
  doesReleaseNoteExist,
}: {
  settings: Settings;
  updateSettings: ReturnType<typeof vi.fn>;
  doesReleaseNoteExist: ReturnType<typeof vi.fn>;
}) {
  vi.doMock("react-i18next", () => ({
    useTranslation: () => ({
      t: (key: string, params?: { version?: string }) => {
        if (key === "whatsNew") {
          return `What's new in v${params?.version}?`;
        }
        if (key === "releaseNotesTitle") {
          return `Release notes for v${params?.version}`;
        }
        return key;
      },
    }),
  }));
  vi.doMock("@/hooks/useAppVersion", () => ({
    useAppVersion: () => "1.3.0",
  }));
  vi.doMock("@/hooks/useSettings", () => ({
    useSettings: () => ({
      settings,
      updateSettings,
    }),
  }));
  vi.doMock("@/contexts/ThemeContext", () => ({
    useTheme: () => ({ theme: "light" }),
  }));
  vi.doMock("@/ipc/types", () => ({
    ipc: {
      system: {
        doesReleaseNoteExist,
      },
    },
  }));
  vi.doMock("@/components/ui/dialog", () => {
    return {
      Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
        open ? <div data-testid="dialog">{children}</div> : null,
      DialogContent: ({ children }: { children: ReactNode }) => (
        <div>{children}</div>
      ),
      DialogHeader: ({ children }: { children: ReactNode }) => (
        <div>{children}</div>
      ),
      DialogTitle: ({ children }: { children: ReactNode }) => (
        <h2>{children}</h2>
      ),
    };
  });

  const { ReleaseNotesDialog } = await import("./ReleaseNotesDialog");
  let result: ReturnType<typeof render> | undefined;
  await act(async () => {
    result = render(<ReleaseNotesDialog />);
    await Promise.resolve();
  });
  return result;
}
