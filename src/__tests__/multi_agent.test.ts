import { CoderAgent } from "../multi_agent/CoderAgent";
import { ReviewerAgent } from "../multi_agent/ReviewerAgent";
import { Orchestrator } from "../multi_agent/Orchestrator";
import { vi } from "vitest";
import * as llmHelper from "../multi_agent/llm_helper";

vi.mock("../multi_agent/llm_helper", () => ({
  callLlm: vi.fn(),
}));

const mockedCallLlm = vi.mocked(llmHelper.callLlm);

describe("Multi-Agent System", () => {
  beforeEach(() => {
    mockedCallLlm.mockClear();
  });

  it("CoderAgent should return thoughts and code", async () => {
    const mockResponse = `
<thinking>
The user wants a function to add two numbers. I will create a simple TypeScript function for this.
</thinking>
<code>
function add(a: number, b: number): number {
  return a + b;
}
</code>
`;
    mockedCallLlm.mockResolvedValue(mockResponse);

    const coder = new CoderAgent();
    const result = await coder.execute("Create a function to add two numbers");

    expect(result.thoughts).toContain("The user wants a function");
    expect(result.output).toContain("function add");
    expect(mockedCallLlm).toHaveBeenCalledOnce();
  });

  it("ReviewerAgent should return thoughts and feedback", async () => {
    const mockResponse = `
<thinking>
The code is simple and correct. I will suggest adding a check for null inputs.
</thinking>
<feedback>
The code looks good, but you could add a check for null inputs.
</feedback>
`;
    mockedCallLlm.mockResolvedValue(mockResponse);

    const reviewer = new ReviewerAgent();
    const result = await reviewer.execute("Some code");

    expect(result.thoughts).toContain("The code is simple");
    expect(result.output).toContain("add a check for null inputs");
    expect(mockedCallLlm).toHaveBeenCalledOnce();
  });

  it("Orchestrator should run the workflow", async () => {
    const coderResponse1 = `
<thinking>
Thinking about the first turn.
</thinking>
<code>
// First version of the code
</code>
`;
    const reviewerResponse = `
<thinking>
Thinking about the review.
</thinking>
<feedback>
Some feedback.
</feedback>
`;
    const coderResponse2 = `
<thinking>
Thinking about the second turn.
</thinking>
<code>
// Second version of the code
</code>
`;

    mockedCallLlm
      .mockResolvedValueOnce(coderResponse1)
      .mockResolvedValueOnce(reviewerResponse)
      .mockResolvedValueOnce(coderResponse2)
      .mockResolvedValueOnce(reviewerResponse); // For the second review

    const orchestrator = new Orchestrator();
    // @ts-expect-error - CoderAgent now takes an appId
    const finalCode = await orchestrator.run("Create a function");

    expect(finalCode).toContain("// Second version of the code");
    expect(mockedCallLlm).toHaveBeenCalledTimes(4);
  });

  it("Orchestrator should stop when reviewer approves", async () => {
    const coderResponse = `
<thinking>
Thinking about the code.
</thinking>
<code>
// Some code
</code>
`;
    const reviewerResponseWithApproval = `
<thinking>
The code looks good.
</thinking>
<feedback>
LGTM! [APPROVED]
</feedback>
`;

    mockedCallLlm
      .mockResolvedValueOnce(coderResponse)
      .mockResolvedValueOnce(reviewerResponseWithApproval);

    const orchestrator = new Orchestrator();
    // @ts-expect-error - CoderAgent now takes an appId
    const finalCode = await orchestrator.run("Create a function");

    expect(finalCode).toContain("// Some code");
    expect(mockedCallLlm).toHaveBeenCalledTimes(2);
  });
});
