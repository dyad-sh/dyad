import { beforeEach, expect, it, vi } from "vitest";

const { readSettings } = vi.hoisted(() => ({ readSettings: vi.fn() }));
vi.mock("@/main/settings", () => ({ readSettings }));

beforeEach(() => {
  vi.resetModules();
  readSettings.mockReset();
});

it.each([undefined, false, true])(
  "keeps startup preference %s for every preview until Dyad restarts",
  async (preference) => {
    readSettings.mockReturnValue({ enablePreviewCookieIsolation: preference });
    const { isPreviewCookieIsolationEnabled } =
      await import("./preview_cookie_isolation");
    // onReady captures this before a renderer can change settings or start an app.
    expect(isPreviewCookieIsolationEnabled()).toBe(preference ?? true);
    readSettings.mockReturnValue({
      enablePreviewCookieIsolation: !(preference ?? true),
    });
    expect(isPreviewCookieIsolationEnabled()).toBe(preference ?? true);
    expect(readSettings).toHaveBeenCalledTimes(1);

    // A new main process applies the saved preference.
    vi.resetModules();
    const restarted = await import("./preview_cookie_isolation");
    expect(restarted.isPreviewCookieIsolationEnabled()).toBe(
      !(preference ?? true),
    );
  },
);
