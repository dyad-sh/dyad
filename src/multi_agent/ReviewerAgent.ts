import { Agent, AgentOutput } from "./Agent";
import { callLlm } from "./llm_helper";

export class ReviewerAgent extends Agent {
  constructor() {
    super(
      "Reviewer",
      "You are a senior software engineer who meticulously reviews code for quality, correctness, and style.",
    );
  }

  async execute(task: string): Promise<AgentOutput> {
    console.log("ReviewerAgent executing task:", task);

    const prompt = `
You are the ${this.name}.
Your role is: ${this.role}

The code to review is:
${task}

First, think about how you will review this code. What are the key things to look for? Are there any potential bugs? Is the code well-structured and easy to read?

Then, provide your feedback on the code.

Your output should be in the following format:

<thinking>
... your thoughts here ...
</thinking>

<feedback>
... your feedback here ...
</feedback>

If the code is good and requires no more changes, end your feedback with the string "[APPROVED]".
`;

    const response = await callLlm(prompt);

    const thoughtsMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/);
    const feedbackMatch = response.match(/<feedback>([\s\S]*?)<\/feedback>/);

    const thoughts = thoughtsMatch ? thoughtsMatch[1].trim() : "";
    const output = feedbackMatch ? feedbackMatch[1].trim() : "";

    return { thoughts, output };
  }
}
