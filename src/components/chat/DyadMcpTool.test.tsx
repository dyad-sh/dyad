import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DyadMcpTool } from "./DyadMcpTool";

describe("DyadMcpTool", () => {
  it("shows a running indicator while the result is pending", () => {
    render(
      <DyadMcpTool
        serverName="my-server"
        toolName="slow_add"
        callContent={`{"a":1}`}
        resultContent={undefined}
        state="pending"
      />,
    );

    // getByText throws if missing, so these assert presence.
    screen.getByText("Tool");
    screen.getByText("my-server");
    screen.getByText("slow_add");
    screen.getByText("Running");
    expect(screen.queryByText("No result")).toBeNull();
  });

  it("drops the running indicator once a result is present", () => {
    render(
      <DyadMcpTool
        serverName="my-server"
        toolName="fast_add"
        callContent={`{"a":1}`}
        resultContent="3"
        state="finished"
      />,
    );

    screen.getByText("fast_add");
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.queryByText("No result")).toBeNull();
  });

  it("marks an aborted call (no result, stream ended)", () => {
    render(
      <DyadMcpTool
        serverName="my-server"
        toolName="slow_add"
        callContent={`{"a":1}`}
        resultContent={undefined}
        state="aborted"
      />,
    );

    screen.getByText("No result");
    expect(screen.queryByText("Running")).toBeNull();
  });
});
