import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PreviewAuthBanner } from "./PreviewAuthBanner";

it.each(["neon", "supabase"] as const)(
  "shows %s registration progress, hides retry, and disappears on success",
  (provider) => {
    const onRetry = vi.fn();
    const view = render(
      <PreviewAuthBanner
        status={{ provider, state: "pending" }}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "in the background",
    );
    expect(screen.getByRole("status").textContent).toContain(
      provider === "neon"
        ? "preview address with Neon"
        : "preview redirect URLs with Supabase",
    );
    expect(screen.getByRole("status").textContent).toContain(
      "may not work until registration finishes",
    );
    expect(
      screen.queryByRole("button", { name: "Restart and retry" }),
    ).toBeNull();
    view.rerender(<PreviewAuthBanner onRetry={onRetry} />);
    expect(screen.queryByRole("status")).toBeNull();
  },
);

it.each(["neon", "supabase"] as const)(
  "replaces %s progress with a persistent failure and retries through restart",
  (provider) => {
    const onRetry = vi.fn();
    const view = render(
      <PreviewAuthBanner
        status={{ provider, state: "pending" }}
        onRetry={onRetry}
      />,
    );
    const status = {
      provider,
      state: "error" as const,
      message: "Could not register the preview address.",
    };
    view.rerender(
      <PreviewAuthBanner status={status} onRetry={onRetry} disabled />,
    );
    expect(screen.getByRole("status").textContent).toContain(status.message);
    expect(screen.getByRole("status").textContent).not.toContain(
      "in the background",
    );
    const retry = screen.getByRole("button", {
      name: "Restart and retry",
    }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
    view.rerender(<PreviewAuthBanner status={status} onRetry={onRetry} />);
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toBeTruthy();
    view.rerender(<PreviewAuthBanner onRetry={onRetry} />);
    expect(screen.queryByRole("status")).toBeNull();
  },
);
