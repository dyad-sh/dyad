import { CoderAgent } from "./CoderAgent";
import { ReviewerAgent } from "./ReviewerAgent";

export interface ConversationTurn {
  agentName: string;
  thoughts: string;
  output: string;
}

export interface OrchestratorResult {
  finalCode: string;
  conversationHistory: ConversationTurn[];
}

export class Orchestrator {
  private reviewer: ReviewerAgent;

  constructor() {
    this.reviewer = new ReviewerAgent();
  }

  async run(initialTask: string, appId: number): Promise<OrchestratorResult> {
    const coder = new CoderAgent(appId);
    let task = initialTask;
    let code = "";
    const conversationHistory: ConversationTurn[] = [];
    const maxTurns = 2; // Let's do 2 turns for now

    console.log(`Orchestrator starting with task: ${initialTask}`);

    for (let i = 0; i < maxTurns; i++) {
      console.log(`--- Turn ${i + 1} ---`);

      // Coder's turn
      console.log(`Task for coder: ${task}`);
      const coderResult = await coder.execute(task);
      console.log(`Coder thoughts:\n${coderResult.thoughts}`);
      console.log(`Coder produced code:\n${coderResult.output}`);
      code = coderResult.output;
      conversationHistory.push({ agentName: "Coder", ...coderResult });

      // Reviewer's turn
      const reviewTask = `Please review the following code:\n${code}`;
      const reviewerResult = await this.reviewer.execute(reviewTask);
      console.log(`Reviewer thoughts:\n${reviewerResult.thoughts}`);
      console.log(`Reviewer provided feedback: ${reviewerResult.output}`);
      const feedback = reviewerResult.output;
      conversationHistory.push({ agentName: "Reviewer", ...reviewerResult });

      // Prepare for next turn
      task = `The user's initial request was: "${initialTask}". The previous code you wrote was:\n${code}\n\nThe reviewer's feedback is: "${feedback}". Please rewrite the code to incorporate the feedback.`;

      if (feedback.includes("[APPROVED]")) {
        console.log("Reviewer approved the code. Finishing the process.");
        return { finalCode: code, conversationHistory };
      }
    }

    console.log("Orchestrator finished.");
    return { finalCode: code, conversationHistory };
  }
}
