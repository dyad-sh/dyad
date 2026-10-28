import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const h = vi.hoisted(() => ({
  saveToken: vi.fn(),
  testConnection: vi.fn(),
  openExternalUrl: vi.fn(),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    gitlab: { saveToken: h.saveToken, testConnection: h.testConnection },
    system: { openExternalUrl: h.openExternalUrl },
  },
}));

const { GitLabCredentialsForm: Form } = await import("./GitLabCredentialsForm");

const report = {
  url: "https://gitlab.com/api/v4/user",
  testedAt: "2026-10-28T12:00:00.000Z",
  appVersion: "1.22.0-alpha.1",
  electronVersion: "40.0.0",
  nodeVersion: "24.11.1",
  platform: "win32",
  arch: "x64",
  results: [
    {
      transport: "Node fetch",
      durationMs: 20,
      httpStatus: null,
      error: "fetch failed; caused by: UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    },
    {
      transport: "Electron net.fetch",
      durationMs: 30,
      httpStatus: 401,
      error: null,
    },
  ],
};

function renderForm(props: { onConnected?: () => void } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Form {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.testConnection.mockReset().mockResolvedValue(report);
  h.saveToken.mockResolvedValue({
    connected: true,
    instanceUrl: "https://gitlab.com",
    username: "rene",
    tokenExpiresAt: null,
  });
});

describe("GitLabCredentialsForm", () => {
  it("tests both connections without a token and copies the displayed report", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    renderForm();
    await user.click(screen.getByTestId("gitlab-test-connection"));
    expect(h.testConnection).toHaveBeenCalledExactlyOnceWith({
      instanceUrl: "https://gitlab.com",
    });
    expect(h.saveToken).not.toHaveBeenCalled();
    const results = await screen.findByTestId("gitlab-connection-diagnostics");
    expect(results).toHaveTextContent("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(results).toHaveTextContent(
      "Electron net.fetch: CONNECTED — HTTP 401",
    );
    await user.click(
      screen.getByRole("button", {
        name: "integrations.gitlab.diagnostics.copy",
      }),
    );
    expect(writeText).toHaveBeenCalledExactlyOnceWith(results.textContent);
    expect(
      screen.getByRole("button", {
        name: "integrations.gitlab.diagnostics.copied",
      }),
    ).toBeInTheDocument();

    await user.clear(screen.getByTestId("gitlab-instance-url-input"));
    expect(screen.queryByTestId("gitlab-connection-diagnostics")).toBeNull();
    expect(screen.getByTestId("gitlab-test-connection")).toBeDisabled();
  });

  it("prevents overlapping tests and edits to the tested URL while pending", async () => {
    let finish!: (value: typeof report) => void;
    h.testConnection.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderForm();
    await userEvent.click(screen.getByTestId("gitlab-test-connection"));
    expect(screen.getByTestId("gitlab-test-connection")).toBeDisabled();
    expect(screen.getByTestId("gitlab-instance-url-input")).toBeDisabled();
    finish(report);
    await screen.findByTestId("gitlab-connection-diagnostics");
    expect(screen.getByTestId("gitlab-test-connection")).toBeEnabled();
  });

  it("shows IPC failures and clipboard errors without losing the report", async () => {
    const user = userEvent.setup();
    h.testConnection.mockRejectedValueOnce(new Error("Diagnostic unavailable"));
    renderForm();
    await user.click(screen.getByTestId("gitlab-test-connection"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Diagnostic unavailable",
    );
    await user.click(screen.getByTestId("gitlab-test-connection"));
    await screen.findByTestId("gitlab-connection-diagnostics");
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("Clipboard unavailable"),
    );
    await user.click(
      screen.getByRole("button", {
        name: "integrations.gitlab.diagnostics.copy",
      }),
    );
    expect(
      await screen.findByTestId("gitlab-credentials-error"),
    ).toHaveTextContent("Clipboard unavailable");
    expect(
      screen.getByTestId("gitlab-connection-diagnostics"),
    ).toBeInTheDocument();
  });

  it("defaults to gitlab.com and needs a token before it can connect", async () => {
    renderForm();

    expect(screen.getByTestId("gitlab-instance-url-input")).toHaveValue(
      "https://gitlab.com",
    );
    expect(screen.getByTestId("gitlab-connect-button")).toBeDisabled();

    await userEvent.type(screen.getByTestId("gitlab-token-input"), "glpat-x");
    expect(screen.getByTestId("gitlab-connect-button")).toBeEnabled();
    expect(screen.queryByTestId("gitlab-insecure-ack")).toBeNull();
  });

  it("sends the address and token, then clears the token field", async () => {
    const onConnected = vi.fn();
    renderForm({ onConnected });

    await userEvent.clear(screen.getByTestId("gitlab-instance-url-input"));
    await userEvent.type(
      screen.getByTestId("gitlab-instance-url-input"),
      "https://gitlab.example.com/",
    );
    await userEvent.type(screen.getByTestId("gitlab-token-input"), "glpat-x");
    await userEvent.click(screen.getByTestId("gitlab-connect-button"));

    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(h.saveToken).toHaveBeenCalledWith({
      instanceUrl: "https://gitlab.example.com/",
      token: "glpat-x",
      acknowledgedInsecure: false,
    });
    expect(screen.getByTestId("gitlab-token-input")).toHaveValue("");
  });

  it("holds a plain-http address behind an acknowledgement", async () => {
    renderForm();

    await userEvent.clear(screen.getByTestId("gitlab-instance-url-input"));
    await userEvent.type(
      screen.getByTestId("gitlab-instance-url-input"),
      "http://gitlab.internal",
    );
    await userEvent.type(screen.getByTestId("gitlab-token-input"), "glpat-x");

    expect(screen.getByTestId("gitlab-insecure-ack")).toBeInTheDocument();
    expect(screen.getByTestId("gitlab-connect-button")).toBeDisabled();

    await userEvent.click(screen.getByTestId("gitlab-insecure-ack"));
    expect(screen.getByTestId("gitlab-connect-button")).toBeEnabled();

    await userEvent.click(screen.getByTestId("gitlab-connect-button"));
    await waitFor(() =>
      expect(h.saveToken).toHaveBeenCalledWith(
        expect.objectContaining({ acknowledgedInsecure: true }),
      ),
    );
  });

  it("does not treat loopback as insecure", async () => {
    renderForm();

    await userEvent.clear(screen.getByTestId("gitlab-instance-url-input"));
    await userEvent.type(
      screen.getByTestId("gitlab-instance-url-input"),
      "http://localhost:3500/gitlab",
    );

    expect(screen.queryByTestId("gitlab-insecure-ack")).toBeNull();
  });

  it("shows the main process's reason when the token is refused", async () => {
    h.saveToken.mockRejectedValue(new Error("needs the api scope"));
    renderForm();

    await userEvent.type(screen.getByTestId("gitlab-token-input"), "glpat-x");
    await userEvent.click(screen.getByTestId("gitlab-connect-button"));

    expect(
      await screen.findByTestId("gitlab-credentials-error"),
    ).toHaveTextContent("needs the api scope");
    // The token stays so the user can fix the address instead of retyping it.
    expect(screen.getByTestId("gitlab-token-input")).toHaveValue("glpat-x");
  });

  it("displays the transport cause from the IPC error and allows retrying", async () => {
    const message =
      "Could not reach GitLab at https://gitlab.com: fetch failed; caused by: UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate";
    h.saveToken.mockRejectedValueOnce(new Error(message));
    const onConnected = vi.fn();
    renderForm({ onConnected });

    await userEvent.type(screen.getByTestId("gitlab-token-input"), "glpat-x");
    await userEvent.click(screen.getByTestId("gitlab-connect-button"));

    expect(
      await screen.findByTestId("gitlab-credentials-error"),
    ).toHaveTextContent(message);
    expect(screen.getByTestId("gitlab-connect-button")).toBeEnabled();
    await userEvent.click(screen.getByTestId("gitlab-connect-button"));
    await waitFor(() => expect(onConnected).toHaveBeenCalledOnce());
    expect(screen.queryByTestId("gitlab-credentials-error")).toBeNull();
  });
});
