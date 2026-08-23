import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getNativeThemeState: vi.fn(),
  listener: undefined as
    | ((state: { shouldUseDarkColors: boolean }) => void)
    | undefined,
  unsubscribe: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    system: { getNativeThemeState: h.getNativeThemeState },
    events: {
      system: {
        onNativeThemeUpdated: (
          listener: (state: { shouldUseDarkColors: boolean }) => void,
        ) => {
          h.listener = listener;
          return h.unsubscribe;
        },
      },
    },
  },
}));

import { ThemeProvider, useTheme } from "./ThemeContext";

function ThemeProbe() {
  const { theme, isDarkMode, setTheme } = useTheme();
  return (
    <>
      <output data-testid="theme-state">{`${theme}:${isDarkMode}`}</output>
      <button onClick={() => setTheme("dark")}>Dark</button>
      <button onClick={() => setTheme("light")}>Light</button>
      <button onClick={() => setTheme("system")}>System</button>
    </>
  );
}

function renderTheme() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("light", "dark");
  h.listener = undefined;
  h.unsubscribe.mockReset();
  h.getNativeThemeState.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThemeProvider", () => {
  it("uses Electron's native theme for System and follows update events", async () => {
    const matchMedia = vi.fn(() => ({ matches: false }));
    vi.stubGlobal("matchMedia", matchMedia);
    h.getNativeThemeState.mockResolvedValue({ shouldUseDarkColors: true });

    renderTheme();

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(screen.getByTestId("theme-state").textContent).toBe("system:true");
    });
    expect(matchMedia).toHaveBeenCalledWith("(prefers-color-scheme: dark)");

    act(() => h.listener?.({ shouldUseDarkColors: false }));

    await waitFor(() => {
      expect(document.documentElement.classList.contains("light")).toBe(true);
      expect(screen.getByTestId("theme-state").textContent).toBe(
        "system:false",
      );
    });
  });

  it("falls back to the browser preference when native theme bootstrap fails", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    h.getNativeThemeState.mockRejectedValue(new Error("IPC unavailable"));

    renderTheme();

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(screen.getByTestId("theme-state").textContent).toBe("system:true");
    });
  });

  it("does not let an older bootstrap response overwrite a native update", async () => {
    let resolveBootstrap!: (state: { shouldUseDarkColors: boolean }) => void;
    h.getNativeThemeState.mockReturnValue(
      new Promise((resolve) => {
        resolveBootstrap = resolve;
      }),
    );

    renderTheme();
    expect(h.listener).toBeDefined();

    act(() => h.listener?.({ shouldUseDarkColors: false }));
    await waitFor(() => {
      expect(screen.getByTestId("theme-state").textContent).toBe(
        "system:false",
      );
    });

    await act(async () => {
      resolveBootstrap({ shouldUseDarkColors: true });
    });

    expect(screen.getByTestId("theme-state").textContent).toBe("system:false");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("keeps an explicit Dark preference independent of native updates", async () => {
    localStorage.setItem("theme", "dark");
    h.getNativeThemeState.mockResolvedValue({ shouldUseDarkColors: false });

    renderTheme();

    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(screen.getByTestId("theme-state").textContent).toBe("dark:true");
    });

    act(() => h.listener?.({ shouldUseDarkColors: false }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("theme-state").textContent).toBe("dark:true");
  });

  it("unsubscribes from native theme updates on unmount", () => {
    h.getNativeThemeState.mockResolvedValue({ shouldUseDarkColors: false });

    const view = renderTheme();
    view.unmount();

    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });
});
