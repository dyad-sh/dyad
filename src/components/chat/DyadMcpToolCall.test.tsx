import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DyadMcpToolCall } from "./DyadMcpToolCall";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { shown: string; total: string }) =>
      opts
        ? `${key}: ${opts.shown} of ${opts.total}`
        : (({ autoApproved: "Auto-approved" } as Record<string, string>)[key] ??
          key),
  }),
}));

vi.mock("./CodeHighlight", () => ({
  CodeHighlight: ({ children }: { children?: React.ReactNode }) => (
    <pre>{children}</pre>
  ),
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

  it("notes truncated input and result in the expanded card", () => {
    render(
      <DyadMcpToolCall
        node={node()}
        resultContent={"\npartial\n"}
        state="finished"
        inputTruncatedFrom={5000}
        resultTruncatedFrom={9000}
      >
        {`\n{"a":1}\n`}
      </DyadMcpToolCall>,
    );
    fireEvent.click(screen.getByText("Tool"));
    screen.getByText(`mcpInputTruncated: 7 of ${(5000).toLocaleString()}`);
    screen.getByText(`mcpResultTruncated: 7 of ${(9000).toLocaleString()}`);
    expect(screen.queryByText(/mcpResultToolTruncated/)).toBeNull();
  });

  it("uses one notice when both the tool and the transcript cut the result", () => {
    render(
      <DyadMcpToolCall
        node={node()}
        resultContent="partial"
        state="finished"
        resultTruncatedFrom={9000}
        resultToolTruncated
      >
        {`{"a":1}`}
      </DyadMcpToolCall>,
    );
    fireEvent.click(screen.getByText("Tool"));
    screen.getByText(`mcpResultBothTruncated: 7 of ${(9000).toLocaleString()}`);
    expect(screen.queryByText(/mcpResultTruncated/)).toBeNull();
  });

  it("uses error wording for a truncated failed result", () => {
    render(
      <DyadMcpToolCall
        node={node()}
        resultContent="partial"
        state="aborted"
        isError
        resultTruncatedFrom={9000}
      >
        {`{"a":1}`}
      </DyadMcpToolCall>,
    );
    fireEvent.click(screen.getByText("Tool"));
    screen.getByText(`mcpErrorTruncated: 7 of ${(9000).toLocaleString()}`);
    expect(screen.queryByText(/mcpResultTruncated/)).toBeNull();
  });

  it("notes a tool cut even when the transcript holds the whole result", () => {
    render(
      <DyadMcpToolCall
        node={node()}
        resultContent="partial"
        state="finished"
        resultToolTruncated
      >
        {`{"a":1}`}
      </DyadMcpToolCall>,
    );
    fireEvent.click(screen.getByText("Tool"));
    screen.getByText("mcpResultToolTruncated");
  });

  it("shows no truncation note for complete payloads", () => {
    render(
      <DyadMcpToolCall node={node()} resultContent="3" state="finished">
        {`{"a":1}`}
      </DyadMcpToolCall>,
    );
    fireEvent.click(screen.getByText("Tool"));
    expect(screen.queryByText(/Truncated:/)).toBeNull();
  });
});
