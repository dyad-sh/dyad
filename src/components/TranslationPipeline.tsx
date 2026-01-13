import {
  CheckCircle2,
  Circle,
  Loader2,
  FileText,
  ChevronRight,
} from "lucide-react";
import { Button } from "./ui/button";

export type PipelinePhase = "document" | "plan" | "act";
export type PhaseStatus = "pending" | "in_progress" | "completed";
// Pipeline mode: "translate" for code translation, "generate" for new contract generation
export type PipelineMode = "translate" | "generate";

interface PhaseInfo {
  name: string;
  description: string;
  status: PhaseStatus;
  details?: string;
}

interface TranslationPipelineProps {
  currentPhase: PipelinePhase;
  documentStatus: PhaseStatus;
  planStatus: PhaseStatus;
  actStatus: PhaseStatus;
  documentDetails?: string;
  planDetails?: string;
  actDetails?: string;
  awaitingApproval?: PipelinePhase | null;
  onApprovePhase1?: () => void;
  onApprovePhase2?: () => void;
  mode?: PipelineMode;
}

export function TranslationPipeline({
  currentPhase,
  documentStatus,
  planStatus,
  actStatus,
  documentDetails,
  planDetails,
  actDetails,
  awaitingApproval,
  onApprovePhase1,
  onApprovePhase2,
  mode = "translate",
}: TranslationPipelineProps) {
  // Mode-specific labels
  const isTranslate = mode === "translate";
  const pipelineTitle = isTranslate ? "Translation Pipeline" : "Generation Pipeline";
  const pipelineSubtitle = isTranslate
    ? "Using advanced context-aware translation"
    : "Using advanced context-aware generation";
  const phases: PhaseInfo[] = [
    {
      name: "📚 Document",
      description: "Gathering ecosystem context",
      status: documentStatus,
      details: documentDetails,
    },
    {
      name: "📋 Plan",
      description: isTranslate ? "Analyzing contract structure" : "Planning contract architecture",
      status: planStatus,
      details: planDetails,
    },
    {
      name: "⚡ Act",
      description: isTranslate ? "Preparing enriched prompt for LLM" : "Generating smart contract code",
      status: actStatus,
      details: actDetails,
    },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Animated Header with Spinner */}
      <div className="text-center mb-8">
        {/* Main Loading Spinner - scales with progress */}
        <div className="relative w-32 h-32 mx-auto mb-6">
          {/* Background ring */}
          <div className="absolute top-0 left-0 w-full h-full border-8 border-gray-200 dark:border-gray-700 rounded-full"></div>

          {/* Progress ring */}
          <svg className="absolute top-0 left-0 w-full h-full -rotate-90">
            <circle
              cx="64"
              cy="64"
              r="56"
              stroke="currentColor"
              strokeWidth="8"
              fill="none"
              className="text-primary transition-all duration-500"
              strokeDasharray={`${2 * Math.PI * 56}`}
              strokeDashoffset={`${2 * Math.PI * 56 * (1 - ((documentStatus === "completed" ? 1 : 0) + (planStatus === "completed" ? 1 : 0) + (actStatus === "completed" ? 1 : 0)) / 3)}`}
              strokeLinecap="round"
            />
          </svg>

          {/* Center content */}
          <div className="absolute inset-0 flex items-center justify-center flex-col">
            <span className="text-3xl font-bold text-gray-800 dark:text-gray-200">
              {Math.round(
                ((documentStatus === "completed" ? 1 : 0) +
                  (planStatus === "completed" ? 1 : 0) +
                  (actStatus === "completed" ? 1 : 0)) *
                  33.33,
              )}
              %
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {currentPhase === "document"
                ? "Researching"
                : currentPhase === "plan"
                  ? "Planning"
                  : "Preparing"}
            </span>
          </div>

          {/* Animated pulse for active phase */}
          <div className="absolute inset-0 rounded-full bg-primary/10 animate-pulse"></div>
        </div>

        <h2 className="text-2xl font-bold mb-2 text-gray-800 dark:text-gray-200">
          {pipelineTitle}
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          {pipelineSubtitle}
        </p>
      </div>

      {/* Pipeline Steps */}
      <div className="space-y-6">
        {phases.map((phase, index) => (
          <div
            key={index}
            className={`relative flex items-start space-x-4 p-4 rounded-lg border-2 transition-all duration-700 ease-in-out transform ${
              phase.status === "in_progress"
                ? "border-primary bg-primary/5 shadow-lg shadow-primary/20 scale-[1.02]"
                : phase.status === "completed"
                  ? "border-green-500 bg-green-50 dark:bg-green-900/10 scale-100"
                  : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 scale-[0.98] opacity-60"
            }`}
          >
            {/* Phase Icon */}
            <div className="flex-shrink-0 mt-1">
              {phase.status === "completed" ? (
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              ) : phase.status === "in_progress" ? (
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              ) : (
                <Circle className="w-6 h-6 text-gray-300 dark:text-gray-600" />
              )}
            </div>

            {/* Phase Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                  {phase.name}
                </h3>
                <span
                  className={`text-xs font-medium px-2 py-1 rounded ${
                    phase.status === "in_progress"
                      ? "bg-primary text-white"
                      : phase.status === "completed"
                        ? "bg-green-500 text-white"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                  }`}
                >
                  {phase.status === "in_progress"
                    ? "In Progress"
                    : phase.status === "completed"
                      ? "Completed"
                      : "Pending"}
                </span>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                {phase.description}
              </p>

              {/* Phase Details */}
              {phase.details && (
                <div className="mt-2 p-3 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap">
                    {phase.details}
                  </p>
                </div>
              )}
            </div>

            {/* Connector Line */}
            {index < phases.length - 1 && (
              <div
                className={`absolute left-7 top-16 w-0.5 h-6 ${
                  phase.status === "completed"
                    ? "bg-green-500"
                    : "bg-gray-200 dark:bg-gray-700"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Live Status Message */}
      <div className="mt-8 text-center">
        <p className="text-sm text-gray-600 dark:text-gray-400 animate-pulse">
          {currentPhase === "document" &&
            documentStatus === "in_progress" &&
            "🔍 Gathering blockchain documentation..."}
          {currentPhase === "plan" &&
            planStatus === "in_progress" &&
            (isTranslate ? "🧠 Analyzing contract patterns..." : "🧠 Planning contract architecture...")}
          {currentPhase === "act" &&
            actStatus === "in_progress" &&
            (isTranslate ? "⚡ Building enriched prompt..." : "⚡ Generating smart contract...")}
          {documentStatus === "completed" &&
            planStatus === "completed" &&
            actStatus === "completed" &&
            (isTranslate ? "✅ Ready to generate code!" : "✅ Contract generation complete!")}
        </p>
      </div>

      {/* Approval Section */}
      {awaitingApproval && (
        <div className="mt-8 p-6 bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-500 rounded-lg">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {awaitingApproval === "document" &&
                  "📚 Phase 1 Complete - Review AI_RULES.md"}
                {awaitingApproval === "plan" &&
                  "📋 Phase 2 Complete - Review Translation Plan"}
              </h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                {awaitingApproval === "document" && (
                  <>
                    An enriched AI_RULES.md file has been generated with current
                    blockchain documentation, version information, and
                    translation patterns. Review the details above before
                    proceeding.
                  </>
                )}
                {awaitingApproval === "plan" && (
                  <>
                    The contract structure has been analyzed. Review the
                    translation strategy above before proceeding to code
                    generation.
                  </>
                )}
              </p>
              <div className="flex items-center gap-3">
                <Button
                  onClick={
                    awaitingApproval === "document"
                      ? onApprovePhase1
                      : onApprovePhase2
                  }
                  className="gap-2"
                >
                  Approve & Continue
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
