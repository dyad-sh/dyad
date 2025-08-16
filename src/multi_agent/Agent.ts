import { Tool } from "./tools/Tool";

export interface AgentOutput {
  thoughts: string;
  output: string;
}

export abstract class Agent {
  public tools: Tool[] = [];

  constructor(
    public name: string,
    public role: string,
  ) {}

  abstract execute(task: string): Promise<AgentOutput>;
}
