import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MigrationPreviewResponse } from "@/ipc/types/migration";
import { MigrationPanelBody } from "./MigrationPanel";

const { preview, migrate } = vi.hoisted(() => ({
  preview: vi.fn(),
  migrate: vi.fn(),
}));
vi.mock("@/ipc/types", () => ({
  ipc: { migration: { preview, migrate } },
}));
vi.mock("@/hooks/useLoadApp", () => ({
  useLoadApp: () => ({ app: { neonActiveBranchId: "dev" } }),
}));
vi.mock("@/hooks/useNeon", () => ({
  useNeon: () => ({
    branches: [
      { branchId: "prod", branchName: "main", type: "production" },
      { branchId: "dev", branchName: "development", type: "development" },
    ],
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const plan: MigrationPreviewResponse = {
  migrationId: "plan-1",
  statements: ["CREATE TABLE tasks (id integer);"],
  hasDataLoss: false,
  warningReasons: [],
  destructiveStatements: [],
};

function deferredPreview() {
  let resolve!: (result: MigrationPreviewResponse) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<MigrationPreviewResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let client: QueryClient;
let onVerified: ReturnType<typeof vi.fn>;
let onBusyChange: ReturnType<typeof vi.fn>;

function mount(autoPreview = false) {
  return render(
    <QueryClientProvider client={client}>
      <MigrationPanelBody
        appId={1}
        autoPreview={autoPreview}
        onVerified={onVerified}
        onBusyChange={onBusyChange}
      />
    </QueryClientProvider>,
  );
}

function button(name: string) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

async function startPreview() {
  fireEvent.click(button("integrations.migration.migrateToProduction"));
  await screen.findByText("integrations.migration.preview.loading");
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
}

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  onVerified = vi.fn();
  onBusyChange = vi.fn();
  migrate.mockResolvedValue({ success: true });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe("migration preview lifecycle", () => {
  it.each(["changes", "empty", "failure"])(
    "settles an automatic preview after Strict Mode effect replay (%s)",
    async (outcome) => {
      const pending = deferredPreview();
      preview.mockReturnValueOnce(pending.promise);
      render(
        <StrictMode>
          <QueryClientProvider client={client}>
            <MigrationPanelBody
              appId={1}
              autoPreview
              onVerified={onVerified}
              onBusyChange={onBusyChange}
            />
          </QueryClientProvider>
        </StrictMode>,
      );
      await screen.findByText("integrations.migration.preview.loading");
      await act(async () => {
        if (outcome === "failure") pending.reject(new Error("Preview failed"));
        else
          pending.resolve(
            outcome === "empty" ? { ...plan, statements: [] } : plan,
          );
      });

      await waitFor(() => {
        expect(
          screen.queryByText("integrations.migration.preview.loading"),
        ).toBeNull();
        expect(onBusyChange).toHaveBeenLastCalledWith(false);
      });
      expect(preview).toHaveBeenCalledOnce();
      if (outcome === "empty") {
        expect(onVerified).toHaveBeenCalledExactlyOnceWith("no-changes");
        expect(screen.queryByRole("dialog")).toBeNull();
      } else if (outcome === "failure") {
        expect(
          screen.getByText("integrations.migration.preview.loadingError"),
        ).toBeTruthy();
        expect(onVerified).not.toHaveBeenCalled();
        preview.mockResolvedValueOnce(plan);
        fireEvent.click(button("integrations.migration.preview.retry"));
        await screen.findByText(plan.statements[0]);
        expect(preview).toHaveBeenCalledTimes(2);
      } else {
        expect(screen.getByText(plan.statements[0])).toBeTruthy();
        expect(onVerified).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["integrations.migration.preview.cancel", "Close"])(
    "clears the loading state via %s before the request finishes",
    async (cancelButton) => {
      const pending = deferredPreview();
      preview.mockReturnValueOnce(pending.promise);
      mount();
      await startPreview();

      fireEvent.click(button(cancelButton));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(
          button("integrations.migration.migrateToProduction").disabled,
        ).toBe(false);
        expect(onBusyChange).toHaveBeenLastCalledWith(false);
      });
      expect(
        screen.queryByText("integrations.migration.computingMigrationPlan"),
      ).toBeNull();

      await act(async () => pending.resolve({ ...plan, statements: [] }));
      expect(onVerified).not.toHaveBeenCalled();
      expect(migrate).not.toHaveBeenCalled();
    },
  );

  it("ignores a cancelled empty plan while a replacement review is loading", async () => {
    const cancelled = deferredPreview();
    const current = deferredPreview();
    preview
      .mockReturnValueOnce(cancelled.promise)
      .mockReturnValueOnce(current.promise);
    mount();
    await startPreview();
    fireEvent.click(button("integrations.migration.preview.cancel"));
    await startPreview();
    expect(preview).toHaveBeenCalledTimes(2);

    await act(async () => cancelled.resolve({ ...plan, statements: [] }));
    expect(onVerified).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText("integrations.migration.preview.loading"),
    ).toBeTruthy();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);

    await act(async () => current.resolve({ ...plan, statements: [] }));
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith("no-changes"));
    expect(onVerified).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the replacement plan when a cancelled request later fails", async () => {
    const cancelled = deferredPreview();
    preview.mockReturnValueOnce(cancelled.promise).mockResolvedValueOnce(plan);
    mount();
    await startPreview();
    fireEvent.click(button("integrations.migration.preview.cancel"));
    fireEvent.click(button("integrations.migration.migrateToProduction"));
    await screen.findByText(plan.statements[0]);

    await act(async () => cancelled.reject(new Error("Old preview failed")));
    expect(screen.queryByText("Old preview failed")).toBeNull();
    expect(screen.getByText(plan.statements[0])).toBeTruthy();
    fireEvent.click(button("integrations.migration.preview.continue"));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "integrations.migration.migrateToProduction",
      }),
    );
    await waitFor(() =>
      expect(migrate).toHaveBeenCalledWith({ appId: 1, migrationId: "plan-1" }),
    );
    await waitFor(() => expect(onVerified).toHaveBeenCalledWith("applied"));
  });

  it("detaches an automatically started preview when cancelled", async () => {
    const pending = deferredPreview();
    preview.mockReturnValueOnce(pending.promise);
    mount(true);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "integrations.migration.preview.cancel",
      }),
    );
    expect(button("integrations.migration.migrateToProduction").disabled).toBe(
      false,
    );

    await act(async () => pending.resolve({ ...plan, statements: [] }));
    expect(onVerified).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalledOnce();
  });

  it("does not verify a preview after its panel unmounts", async () => {
    const pending = deferredPreview();
    preview.mockReturnValueOnce(pending.promise);
    const view = mount();
    await startPreview();
    view.unmount();

    await act(async () => pending.resolve({ ...plan, statements: [] }));
    expect(onVerified).not.toHaveBeenCalled();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
});
