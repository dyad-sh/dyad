import { describe, expect, it } from "vitest";
import { parseAgentArtifacts } from "./parser";

const analysisTag = `<dyad-agent-analysis>{"goals":["Ship"],"constraints":["No regressions"],"acceptanceCriteria":["Tests pass"],"risks":["Time"],"clarifications":[],"dyadTagRefs":["user:1"]}</dyad-agent-analysis>`;
const planTag = `<dyad-agent-plan version="2">{"todos":[{"todoId":"TD-01","title":"Draft interfaces","description":"internal plan","owner":"Planner","inputs":["analysis"],"outputs":["design"],"completionCriteria":"interfaces defined","status":"pending","dyadTagRefs":["analysis:1"]}],"dyadTagRefs":["analysis:1"],"dyadTagContext":["user:1"]}</dyad-agent-plan>`;

const updateTag = `<dyad-agent-todo-update todoId="TD-01" status="completed" dyadTagRefs="plan:2">All done</dyad-agent-todo-update>`;
const logTag = `<dyad-agent-log todoId="TD-01" type="execution" dyadTagRefs="run:1">Implemented and verified</dyad-agent-log>`;
const statusTag = `<dyad-agent-status state="executing"></dyad-agent-status>`;
const focusTag = `<dyad-agent-focus todoId="TD-02"></dyad-agent-focus>`;
const autoTag = `<dyad-agent-auto enabled="true"></dyad-agent-auto>`;

describe("parseAgentArtifacts", () => {
  it("parses analysis and plan payloads", () => {
    const artifacts = parseAgentArtifacts(`${analysisTag}${planTag}`);
    expect(artifacts.analysis?.goals).toEqual(["Ship"]);
    expect(artifacts.plan?.version).toBe(2);
    expect(artifacts.plan?.todos).toHaveLength(1);
    expect(artifacts.plan?.todos[0].todoId).toBe("TD-01");
    expect(artifacts.plan?.todos[0].status).toBe("pending");
  });

  it("collects updates, logs, status, and auto flags", () => {
    const artifacts = parseAgentArtifacts(
      `${updateTag}${logTag}${statusTag}${focusTag}${autoTag}`,
    );
    expect(artifacts.todoUpdates).toEqual([
      { todoId: "TD-01", status: "completed", dyadTagRefs: ["plan:2"], note: "All done" },
    ]);
    expect(artifacts.logs).toEqual([
      {
        todoId: "TD-01",
        todoKey: undefined,
        logType: "execution",
        content: "Implemented and verified",
        dyadTagRefs: ["run:1"],
        metadata: undefined,
      },
    ]);
    expect(artifacts.workflowStatus).toBe("executing");
    expect(artifacts.currentTodoId).toBe("TD-02");
    expect(artifacts.autoAdvance).toBe(true);
  });

  it("collects warnings for invalid payloads without throwing", () => {
    const artifacts = parseAgentArtifacts(
      `<dyad-agent-plan>{"todos": [{"todoId": "TD-01","title": "x"}]</dyad-agent-plan>`,
    );
    expect(artifacts.plan).toBeUndefined();
    expect(artifacts.warnings.length).toBeGreaterThan(0);
  });
});
