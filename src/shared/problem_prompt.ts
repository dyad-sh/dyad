import type { ProblemReport } from "../ipc/ipc_types";

/**
 * Creates a more concise version of the problem fix prompt for cases where
 * brevity is preferred.
 */
export function createProblemFixPrompt(problemReport: ProblemReport): string {
  const { problems } = problemReport;

  if (problems.length === 0) {
    return "No TypeScript problems detected.";
  }

  const totalProblems = problems.length;
  let prompt = `Fix these ${totalProblems} TypeScript compile-time error${totalProblems === 1 ? "" : "s"}:\n\n`;

  problems.forEach((problem, index) => {
    prompt += `${index + 1}. ${problem.file}:${problem.line}:${problem.column} - ${problem.message} (TS${problem.code})\n`;
    if (problem.snippet) {
      prompt += `\`\`\`\n${problem.snippet}\n\`\`\`\n`;
    }
    prompt += "\n";
  });

  prompt += "\nPlease fix all errors in a concise way.";

  return prompt;
}
