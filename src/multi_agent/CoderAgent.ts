import { Agent, AgentOutput } from "./Agent";
import { callLlm } from "./llm_helper";
import { FileSystemTool } from "./tools/FileSystemTool";

export class CoderAgent extends Agent {
  constructor(appId: number) {
    super(
      "Coder",
      "You are a world-class software engineer who writes clean, efficient, and well-documented code.",
    );
    this.tools.push(new FileSystemTool(appId));
  }

  async execute(task: string): Promise<AgentOutput> {
    console.log("CoderAgent executing task:", task);

    let thoughts = "";
    let code = "";
    let prompt = this.createInitialPrompt(task);

    for (let i = 0; i < 5; i++) {
      // Max 5 turns to prevent infinite loops
      const response = await callLlm(prompt);

      const thoughtsMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/);
      thoughts = thoughtsMatch ? thoughtsMatch[1].trim() : "";
      console.log(`Coder thoughts: ${thoughts}`);

      const toolCallMatch = response.match(
        /<tool name="(\w+)" args='([\s\S]*?)' \/>/,
      );
      if (toolCallMatch) {
        const toolName = toolCallMatch[1];
        const toolArgs = JSON.parse(toolCallMatch[2]);
        const tool = this.tools.find((t) => t.name === toolName);

        if (tool) {
          console.log(`Calling tool: ${toolName} with args:`, toolArgs);
          const toolResult = await tool.execute(toolArgs);
          prompt = this.createPromptWithToolResult(task, thoughts, toolResult);
        } else {
          prompt = this.createPromptWithToolResult(
            task,
            thoughts,
            `Error: Tool ${toolName} not found.`,
          );
        }
      } else {
        const codeMatch = response.match(/<code>([\s\S]*?)<\/code>/);
        code = codeMatch ? codeMatch[1].trim() : "";
        return { thoughts, output: code };
      }
    }

    return {
      thoughts,
      output: "Could not complete the task within the turn limit.",
    };
  }

  private createInitialPrompt(task: string): string {
    const toolDescriptions = this.tools
      .map(
        (t) =>
          `- ${t.name}: ${t.description} - Arguments: ${JSON.stringify(t.execute.toString())}`,
      )
      .join("\n");

    return `
You are the ${this.name}.
Your role is: ${this.role}

You have access to the following tools:
${toolDescriptions}

To use a tool, output a tool call in the following format:
<tool name="toolName" args='{"arg1": "value1", "arg2": "value2"}' />

The user's request is:
${task}

First, think about how you will approach this task. Then, either call a tool or provide the final code.

Your output should be in the following format:

<thinking>
... your thoughts here ...
</thinking>

... either a tool call or the final code ...
`;
  }

  private createPromptWithToolResult(
    task: string,
    thoughts: string,
    toolResult: any,
  ): string {
    return `
You are the ${this.name}.
Your role is: ${this.role}

The user's request is:
${task}

Your previous thought was:
${thoughts}

You called a tool and the result is:
${JSON.stringify(toolResult, null, 2)}

Now, think about the next step. Then, either call another tool or provide the final code.
`;
  }
}
