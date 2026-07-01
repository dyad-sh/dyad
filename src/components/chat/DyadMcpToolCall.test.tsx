import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DyadMcpToolCall } from "./DyadMcpToolCall";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({ autoApproved: "Auto-approved" })[key] ?? key,
  }),
}));

function node(extra?: Record<string, string>) {
  return {
    properties: {
      serverName: "my-server",
      toolName: "slow_add",
      ...extra,
    },
  };
}

describe("DyadMcpToolCall", () => {
  it("legacy (no state) renders a call-only card", () => {
    render(<DyadMcpToolCall node={node()}>{`{"a":1}`}</DyadMcpToolCall>);
    screen.getByText("Tool Call");
    screen.getByText("my-server");
    screen.getByText("slow_add");
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.queryByText("Result")).toBeNull();
  });

  it("merged pending shows a running indicator", () => {
    render(
      <DyadMcpToolCall node={node()} state="pending">
        {`{"a":1}`}
      </DyadMcpToolCall>,
    );
    screen.getByText("Tool");
    screen.getByText("Running");
    expect(screen.queryByText("No result")).toBeNull();
  });

  it("merged finished drops the running indicator", () => {
    render(
      <DyadMcpToolCall node={node()} resultContent="3" state="finished">
        {`{"a":1}`}
      </DyadMcpToolCall>,
    );
    screen.getByText("Tool");
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.queryByText("No result")).toBeNull();
  });

  it("merged aborted (no result, stream ended)", () => {
    render(
      <DyadMcpToolCall node={node()} state="aborted">
        {`{"a":1}`}
      </DyadMcpToolCall>,
    );
    screen.getByText("No result");
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("shows a Failed label for an errored result", () => {
    render(
      <DyadMcpToolCall
        node={node()}
        resultContent="boom"
        state="aborted"
        isError
      >
        {`{"a":1}`}
      </DyadMcpToolCall>,
    );
    screen.getByText("Tool");
    screen.getByText("Failed");
    expect(screen.queryByText("No result")).toBeNull();
  });

  it("preserves the auto-approved badge and reason in merged mode", () => {
    render(
      <DyadMcpToolCall
        node={node({ autoApprovedReason: "matches allowlist" })}
        resultContent="3"
        state="finished"
      >
        {`{"a":1}`}
      </DyadMcpToolCall>,
    );
    screen.getByText("Auto-approved");
    screen.getByText("matches allowlist");
  });
});
