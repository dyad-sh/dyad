import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@/ipc/types";
import type { CatalogInput } from "@/ipc/types/mcp_catalog";
import { PluginSetupSection } from "./PluginSetupSection";

vi.mock("./AddPluginDialog", () => ({
  useOauthCallbackPort: () => 53682,
}));

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 1,
    name: "Test Server",
    transport: "http",
    command: null,
    args: null,
    envJson: null,
    headersJson: null,
    url: "https://example.com/mcp",
    enabled: false,
    oauthEnabled: false,
    oauthConnected: false,
    oauthCallbackPort: null,
    oauthClientId: null,
    envUnreadable: false,
    headersUnreadable: false,
    catalogSlug: "test",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

// Fills inputs in render order; labels aren't tied to the inputs here,
// so address them positionally.
function fillInputs(values: string[]) {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
  all.forEach((input, i) => {
    if (values[i] !== undefined) {
      fireEvent.change(input, { target: { value: values[i] } });
    }
  });
}

describe("PluginSetupSection", () => {
  it("writes a header input to headersJson with its prefix and keeps existing headers", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const inputs: CatalogInput[] = [
      {
        kind: "header",
        name: "Authorization",
        prefix: "Bearer ",
        label: "Key",
      },
    ];
    render(
      <PluginSetupSection
        server={makeServer({ headersJson: { "X-Existing": "1" } })}
        inputs={inputs}
        isSaving={false}
        onSave={onSave}
      />,
    );

    fillInputs(["secret-key"]);
    fireEvent.click(screen.getByRole("button", { name: "Save & enable" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        enabled: true,
        headersJson: { "X-Existing": "1", Authorization: "Bearer secret-key" },
      }),
    );
    // Header setups don't show the OAuth redirect hint.
    expect(screen.queryByText(/redirect URI/i)).toBeNull();
  });

  it("writes an env input to envJson", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const inputs: CatalogInput[] = [
      { kind: "env", name: "API_TOKEN", label: "Token" },
    ];
    render(
      <PluginSetupSection
        server={makeServer({ transport: "stdio", url: null })}
        inputs={inputs}
        isSaving={false}
        onSave={onSave}
      />,
    );

    fillInputs(["tok-123"]);
    fireEvent.click(screen.getByRole("button", { name: "Save & enable" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        envJson: { API_TOKEN: "tok-123" },
      }),
    );
  });

  it("writes oauth client id/secret and shows the redirect-URI hint with the callback port", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const inputs: CatalogInput[] = [
      { kind: "oauthClientId" },
      { kind: "oauthClientSecret" },
    ];
    render(
      <PluginSetupSection
        server={makeServer()}
        inputs={inputs}
        isSaving={false}
        onSave={onSave}
      />,
    );

    // The client id renders as text, the secret as a password field.
    expect(screen.getByText(/localhost:53682\/callback/)).toBeTruthy();

    fillInputs(["client-abc", "secret-xyz"]);
    fireEvent.click(screen.getByRole("button", { name: "Save & enable" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        oauthClientId: "client-abc",
        oauthClientSecret: "secret-xyz",
      }),
    );
  });

  it("lets an optional input stay blank and skips writing it", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const inputs: CatalogInput[] = [
      { kind: "env", name: "API_TOKEN", label: "Token" },
      { kind: "env", name: "ACCOUNT_ID", label: "Account ID", optional: true },
    ];
    render(
      <PluginSetupSection
        server={makeServer({ transport: "stdio", url: null })}
        inputs={inputs}
        isSaving={false}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("Account ID (optional)")).toBeTruthy();
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Save & enable",
    });
    expect(button.disabled).toBe(true);

    fillInputs(["tok-123"]);
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        envJson: { API_TOKEN: "tok-123" },
      }),
    );
  });

  it("in optional mode, saves a filled value without enabling the server", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const inputs: CatalogInput[] = [
      {
        kind: "header",
        name: "X-Workspace",
        prefix: "ws-",
        label: "Workspace",
        optional: true,
      },
    ];
    render(
      <PluginSetupSection
        server={makeServer({ enabled: true, headersJson: { "X-Other": "1" } })}
        inputs={inputs}
        isSaving={false}
        onSave={onSave}
        variant="optional"
      />,
    );

    expect(screen.getByText("Optional settings")).toBeTruthy();
    // The heading already says these are optional.
    expect(screen.getByText("Workspace")).toBeTruthy();
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Save",
    });
    expect(button.disabled).toBe(true);

    fillInputs(["acme"]);
    fireEvent.click(button);

    expect(onSave).toHaveBeenCalledWith({
      id: 1,
      headersJson: { "X-Other": "1", "X-Workspace": "ws-acme" },
    });
  });

  it("clears the optional form after a successful save", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PluginSetupSection
        server={makeServer({ transport: "stdio", url: null, enabled: true })}
        inputs={[
          {
            kind: "env",
            name: "ACCOUNT_ID",
            label: "Account ID",
            optional: true,
          },
        ]}
        isSaving={false}
        onSave={onSave}
        variant="optional"
      />,
    );

    fillInputs(["123"]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const input = document.querySelector<HTMLInputElement>("input")!;
    await waitFor(() => expect(input.value).toBe(""));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps typed optional values when the save fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("save failed"));
    render(
      <PluginSetupSection
        server={makeServer({ transport: "stdio", url: null, enabled: true })}
        inputs={[
          {
            kind: "env",
            name: "ACCOUNT_ID",
            label: "Account ID",
            optional: true,
          },
        ]}
        isSaving={false}
        onSave={onSave}
        variant="optional"
      />,
    );

    fillInputs(["123"]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("123");
  });

  it("locks the fields while a save is in flight", () => {
    render(
      <PluginSetupSection
        server={makeServer({ transport: "stdio", url: null, enabled: true })}
        inputs={[
          {
            kind: "env",
            name: "ACCOUNT_ID",
            label: "Account ID",
            optional: true,
          },
        ]}
        isSaving
        onSave={vi.fn()}
        variant="optional"
      />,
    );

    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(input.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy();
  });

  it("locks the optional form when disabled", () => {
    render(
      <PluginSetupSection
        server={makeServer({ transport: "stdio", url: null })}
        inputs={[
          {
            kind: "env",
            name: "ACCOUNT_ID",
            label: "Account ID",
            optional: true,
          },
        ]}
        isSaving={false}
        onSave={vi.fn()}
        variant="optional"
        disabled
      />,
    );

    fillInputs(["123"]);
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(input.disabled).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled,
    ).toBe(true);
  });

  it("keeps Save disabled until every input is filled", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const inputs: CatalogInput[] = [
      { kind: "oauthClientId" },
      { kind: "oauthClientSecret" },
    ];
    render(
      <PluginSetupSection
        server={makeServer()}
        inputs={inputs}
        isSaving={false}
        onSave={onSave}
      />,
    );

    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Save & enable",
    });
    expect(button.disabled).toBe(true);

    // Only the first field filled: still incomplete.
    const allInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>("input"),
    );
    fireEvent.change(allInputs[0], { target: { value: "client-abc" } });
    expect(button.disabled).toBe(true);

    fireEvent.change(allInputs[1], { target: { value: "secret-xyz" } });
    expect(button.disabled).toBe(false);
  });
});
