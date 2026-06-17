export function isExploreCodeSubagentPrompt(text: string): boolean {
  return (
    text.includes("User query:") &&
    text.includes("App component render flow") &&
    text.includes("Intent:")
  );
}

export function buildExploreCodeNestedToolArgs() {
  return {
    query: "App component render flow",
    intent: "explain",
    max_files: 4,
  };
}

export function buildExploreCodeSubmitReportArgs() {
  return {
    primaryCandidateIds: ["c1", "c2"],
    flow: [
      {
        candidateId: "c2",
        role: "entry",
        fact: "mounts the App component into the DOM",
      },
      {
        candidateId: "c1",
        role: "UI",
        fact: "owns the visible page content",
      },
    ],
    readTargets: [],
    missingCoverage: [],
    searchSuggestions: [],
  };
}

export function buildExploreCodeSubagentReport(): string {
  return [
    "## explore_code report",
    "",
    'Query: "App component render flow"',
    "Task class: component-flow",
    "Confidence: high",
    "Compiler signal: strong",
    "",
    "Structured summary:",
    "```json",
    JSON.stringify(
      {
        confidence: "high",
        taskClass: "component-flow",
        compilerSignal: "strong",
        primaryFiles: [
          {
            path: "src/App.tsx",
            range: "1-20",
            symbols: ["App"],
            purpose: "defines the visible page content",
          },
          {
            path: "src/main.tsx",
            range: "1-20",
            symbols: ["root.render"],
            purpose: "mounts App into the DOM",
          },
        ],
        secondaryFiles: [],
        editTarget: null,
        coverage: {
          observed: ["component/UI handler"],
          missing: [],
        },
        recommendedPrimaryAction: {
          action: "answer_from_report",
          reason:
            "The report has enough high-confidence findings for an answer-only investigation.",
        },
      },
      null,
      2,
    ),
    "```",
    "",
    "Findings:",
    "1. src/App.tsx:1-20 - App",
    "   Fact: defines the App component and root render content.",
    "   Evidence: App is the exported root component.",
    "2. src/main.tsx:1-20 - root.render",
    "   Fact: mounts the App component into the DOM.",
    "   Evidence: main.tsx imports App and renders it.",
    "",
    "Flow:",
    "main.tsx mounts App, and App owns the visible page content.",
    "",
    "Edit target:",
    "none - this is an answer-only render-flow question.",
    "",
    "Recommended primary action:",
    "answer_from_report: The report has enough high-confidence findings for an answer-only investigation.",
  ].join("\n");
}
