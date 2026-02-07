import React, { useState, useEffect } from "react";
import { useAtom, useAtomValue } from "jotai";
import { pendingQuestionnaireAtom } from "@/atoms/planAtoms";
import { useStreamChat } from "@/hooks/useStreamChat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Send,
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Circle,
} from "lucide-react";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";

const MAX_DISPLAYED_OPTIONS = 3;

export function QuestionnaireInput() {
  const [questionnaire, setQuestionnaire] = useAtom(pendingQuestionnaireAtom);
  const chatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage, isStreaming } = useStreamChat();

  // Track current question index
  const [currentIndex, setCurrentIndex] = useState(0);
  // Store all responses
  const [responses, setResponses] = useState<Record<string, string | string[]>>(
    {},
  );
  // Store additional free-form text for each question
  const [additionalTexts, setAdditionalTexts] = useState<
    Record<string, string>
  >({});
  // Expand/collapse state
  const [isExpanded, setIsExpanded] = useState(true);

  // Reset state when questionnaire changes
  useEffect(() => {
    setCurrentIndex(0);
    setResponses(() => {
      // Auto-select the first option for radio questions
      const initial: Record<string, string | string[]> = {};
      if (questionnaire) {
        for (const q of questionnaire.questions) {
          if (q.type === "radio" && q.options && q.options.length > 0) {
            initial[q.id] = q.options[0];
          }
        }
      }
      return initial;
    });
    setAdditionalTexts({});
    setIsExpanded(true);
  }, [
    questionnaire?.chatId,
    questionnaire?.title,
    questionnaire?.questions?.length,
  ]);

  if (!questionnaire || questionnaire.chatId !== chatId) return null;

  const currentQuestion = questionnaire.questions[currentIndex];

  // Guard against empty questions array or out-of-bounds index
  if (!currentQuestion) {
    return null;
  }

  // Calculate if we're on the last question
  const isLastQuestion = currentIndex === questionnaire.questions.length - 1;

  // Sentinel value for the custom free-form radio option
  const CUSTOM_OPTION = "__custom__";

  // Get the final response value (combining selected option with additional text)
  const getFinalResponse = (questionId: string): string => {
    const response = responses[questionId];
    const additionalText = additionalTexts[questionId];

    // For radio/select: if custom option selected, use the typed text
    if (response === CUSTOM_OPTION) {
      return additionalText || "(no answer)";
    }

    let formattedResponse: string;
    if (Array.isArray(response)) {
      formattedResponse = response.join(", ");
    } else {
      formattedResponse = response || "";
    }

    // For checkbox: append additional text if present
    if (additionalText) {
      if (formattedResponse) {
        return `${formattedResponse}, ${additionalText}`;
      }
      return additionalText;
    }

    return formattedResponse || "(no answer)";
  };

  // Check if the current question has a valid answer
  const hasValidAnswer = (): boolean => {
    const currentResponse = responses[currentQuestion.id];
    const additionalText = additionalTexts[currentQuestion.id];

    // Custom option requires typed text
    if (currentResponse === CUSTOM_OPTION) {
      return !!additionalText;
    }

    const hasResponse = Array.isArray(currentResponse)
      ? currentResponse.length > 0
      : !!currentResponse;
    const hasAdditionalText = !!additionalText;

    return hasResponse || hasAdditionalText;
  };

  const handleNext = () => {
    if (currentQuestion.required !== false && !hasValidAnswer()) {
      return;
    }

    if (isLastQuestion) {
      handleSubmit();
    } else {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handleSubmit = () => {
    if (!chatId) return;

    const formattedResponses = questionnaire.questions
      .map((q) => {
        const answer = getFinalResponse(q.id);
        return `**${q.question}**\n${answer}`;
      })
      .join("\n\n");

    streamMessage({
      chatId,
      prompt: `Here are my responses to the questionnaire:\n\n${formattedResponses}`,
    });

    // Clear questionnaire after submission
    setQuestionnaire(null);
  };

  // Helper to determine if Next button should be disabled
  const isNextDisabled = () => {
    if (isStreaming && isLastQuestion) return true;
    if (currentQuestion.required === false) return false;
    return !hasValidAnswer();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isNextDisabled()) {
        handleNext();
      }
    }
  };

  return (
    <div className="border-b border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {isExpanded ? (
            <>
              <ClipboardList className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm">{questionnaire.title}</span>
            </>
          ) : (
            <>
              <Circle className="w-4 h-4 text-blue-500 flex-shrink-0" />
              <span className="text-sm truncate">
                {currentQuestion.question}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                ({currentIndex + 1}/{questionnaire.questions.length})
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentIndex + 1} of {questionnaire.questions.length}
          </span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3">
          {/* Current question input */}
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">
                {currentQuestion.question}
                {currentQuestion.required !== false && (
                  <span className="text-red-500 ml-1">*</span>
                )}
              </Label>
              {currentQuestion.placeholder && (
                <p className="text-xs text-muted-foreground">
                  {currentQuestion.placeholder}
                </p>
              )}

              <div className="mt-2">
                {currentQuestion.type === "text" && (
                  <Input
                    autoFocus
                    placeholder="Type your answer..."
                    value={(responses[currentQuestion.id] as string) || ""}
                    onChange={(e) =>
                      setResponses((prev) => ({
                        ...prev,
                        [currentQuestion.id]: e.target.value,
                      }))
                    }
                    onKeyDown={handleKeyDown}
                  />
                )}

                {currentQuestion.type === "radio" &&
                  currentQuestion.options && (
                    <RadioGroup
                      value={(responses[currentQuestion.id] as string) || ""}
                      onValueChange={(value: string) => {
                        setResponses((prev) => ({
                          ...prev,
                          [currentQuestion.id]: value,
                        }));
                        // Clear custom text when selecting a predefined option
                        if (value !== CUSTOM_OPTION) {
                          setAdditionalTexts((prev) => ({
                            ...prev,
                            [currentQuestion.id]: "",
                          }));
                        }
                      }}
                      className="space-y-0.5"
                    >
                      {currentQuestion.options
                        .slice(0, MAX_DISPLAYED_OPTIONS)
                        .map((option) => (
                          <div
                            key={option}
                            className="flex items-center space-x-2 py-1 px-2 rounded hover:bg-muted/50 transition-colors"
                          >
                            <RadioGroupItem
                              value={option}
                              id={`${currentQuestion.id}-${option}`}
                            />
                            <Label
                              htmlFor={`${currentQuestion.id}-${option}`}
                              className="text-sm font-normal cursor-pointer flex-1"
                            >
                              {option}
                            </Label>
                          </div>
                        ))}
                      {/* Custom free-form option integrated as a radio item */}
                      <div className="flex items-center space-x-2 py-1 px-2 rounded hover:bg-muted/50 transition-colors">
                        <RadioGroupItem
                          value={CUSTOM_OPTION}
                          id={`${currentQuestion.id}-custom`}
                        />
                        <Input
                          placeholder="Other..."
                          className="flex-1 h-7 text-sm"
                          value={additionalTexts[currentQuestion.id] || ""}
                          onFocus={() => {
                            // Auto-select the custom radio when input is focused
                            setResponses((prev) => ({
                              ...prev,
                              [currentQuestion.id]: CUSTOM_OPTION,
                            }));
                          }}
                          onChange={(e) => {
                            setAdditionalTexts((prev) => ({
                              ...prev,
                              [currentQuestion.id]: e.target.value,
                            }));
                            // Auto-select the custom radio when typing
                            setResponses((prev) => ({
                              ...prev,
                              [currentQuestion.id]: CUSTOM_OPTION,
                            }));
                          }}
                          onKeyDown={handleKeyDown}
                        />
                      </div>
                    </RadioGroup>
                  )}

                {currentQuestion.type === "checkbox" &&
                  currentQuestion.options && (
                    <div className="space-y-0.5">
                      {currentQuestion.options
                        .slice(0, MAX_DISPLAYED_OPTIONS)
                        .map((option) => (
                          <div
                            key={option}
                            className="flex items-center space-x-2 py-1 px-2 rounded hover:bg-muted/50 transition-colors"
                          >
                            <Checkbox
                              id={`${currentQuestion.id}-${option}`}
                              checked={(
                                (responses[currentQuestion.id] as
                                  | string[]
                                  | undefined) || []
                              ).includes(option)}
                              onCheckedChange={(checked) => {
                                setResponses((prev) => {
                                  const current =
                                    (prev[currentQuestion.id] as
                                      | string[]
                                      | undefined) || [];
                                  if (checked) {
                                    return {
                                      ...prev,
                                      [currentQuestion.id]: [
                                        ...current,
                                        option,
                                      ],
                                    };
                                  }
                                  return {
                                    ...prev,
                                    [currentQuestion.id]: current.filter(
                                      (o) => o !== option,
                                    ),
                                  };
                                });
                              }}
                            />
                            <Label
                              htmlFor={`${currentQuestion.id}-${option}`}
                              className="text-sm font-normal cursor-pointer flex-1"
                            >
                              {option}
                            </Label>
                          </div>
                        ))}
                      {/* Free-form text input as an inline row (no checkbox) */}
                      <div className="flex items-center py-1 px-2 rounded hover:bg-muted/50 transition-colors">
                        <Input
                          placeholder="Other..."
                          className="flex-1 h-7 text-sm"
                          value={additionalTexts[currentQuestion.id] || ""}
                          onChange={(e) =>
                            setAdditionalTexts((prev) => ({
                              ...prev,
                              [currentQuestion.id]: e.target.value,
                            }))
                          }
                          onKeyDown={handleKeyDown}
                        />
                      </div>
                    </div>
                  )}
              </div>
            </div>

            <div className="flex justify-between">
              <Button
                onClick={() => setCurrentIndex((prev) => prev - 1)}
                disabled={currentIndex === 0}
                variant="ghost"
                size="sm"
              >
                <ArrowLeft size={14} className="mr-1.5" />
                Back
              </Button>
              <Button
                onClick={handleNext}
                disabled={isNextDisabled()}
                size="sm"
              >
                {isLastQuestion ? (
                  <>
                    <Send size={14} className="mr-1.5" />
                    Submit
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight size={14} className="ml-1.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
