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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Send,
  ArrowRight,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Circle,
} from "lucide-react";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";

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
    setResponses({});
    setAdditionalTexts({});
    setIsExpanded(true);
  }, [questionnaire?.chatId, questionnaire?.title]);

  if (!questionnaire || questionnaire.chatId !== chatId) return null;

  const currentQuestion = questionnaire.questions[currentIndex];

  // Guard against empty questions array or out-of-bounds index
  if (!currentQuestion) {
    return null;
  }

  // Calculate if we're on the last question
  const isLastQuestion = currentIndex === questionnaire.questions.length - 1;

  // Get the final response value (combining selected option with additional text)
  const getFinalResponse = (questionId: string): string => {
    const response = responses[questionId];
    const additionalText = additionalTexts[questionId];

    let formattedResponse: string;
    if (Array.isArray(response)) {
      formattedResponse = response.join(", ");
    } else {
      formattedResponse = response || "";
    }

    // If there's additional text, append it
    if (additionalText) {
      if (formattedResponse) {
        return `${formattedResponse}\nAdditional notes: ${additionalText}`;
      }
      return additionalText;
    }

    return formattedResponse || "(no answer)";
  };

  const handleNext = () => {
    // Validate current response if required
    const currentResponse = responses[currentQuestion.id];
    const additionalText = additionalTexts[currentQuestion.id];
    const hasResponse = Array.isArray(currentResponse)
      ? currentResponse.length > 0
      : !!currentResponse;
    const hasAdditionalText = !!additionalText;

    // Allow either a selected option or free-form text
    if (
      currentQuestion.required !== false &&
      !hasResponse &&
      !hasAdditionalText
    ) {
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
    // Only block submit (last question) during streaming, allow navigation to next questions
    if (isStreaming && isLastQuestion) return true;
    if (currentQuestion.required === false) return false;

    const currentResponse = responses[currentQuestion.id];
    const additionalText = additionalTexts[currentQuestion.id];
    const hasResponse = Array.isArray(currentResponse)
      ? currentResponse.length > 0
      : !!currentResponse;
    const hasAdditionalText = !!additionalText;

    // Allow either a selected option or free-form text
    return !hasResponse && !hasAdditionalText;
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

              <div className="mt-2 space-y-3">
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
                    <>
                      <RadioGroup
                        value={(responses[currentQuestion.id] as string) || ""}
                        onValueChange={(value) =>
                          setResponses((prev) => ({
                            ...prev,
                            [currentQuestion.id]: value,
                          }))
                        }
                        className="space-y-1.5"
                      >
                        {currentQuestion.options.map((option) => (
                          <div
                            key={option}
                            className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50 transition-colors"
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
                      </RadioGroup>
                      {/* Always show free-form text input */}
                      <div className="pt-2 border-t border-border/50">
                        <Label className="text-xs text-muted-foreground mb-1.5 block">
                          Or provide your own answer:
                        </Label>
                        <Input
                          placeholder="Type a custom answer..."
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
                    </>
                  )}

                {currentQuestion.type === "checkbox" &&
                  currentQuestion.options && (
                    <>
                      <div className="space-y-1.5">
                        {currentQuestion.options.map((option) => (
                          <div
                            key={option}
                            className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50 transition-colors"
                          >
                            <Checkbox
                              id={`${currentQuestion.id}-${option}`}
                              checked={(
                                (responses[currentQuestion.id] as string[]) ||
                                []
                              ).includes(option)}
                              onCheckedChange={(checked) => {
                                setResponses((prev) => {
                                  const current =
                                    (prev[currentQuestion.id] as string[]) ||
                                    [];
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
                      </div>
                      {/* Always show free-form text input */}
                      <div className="pt-2 border-t border-border/50">
                        <Label className="text-xs text-muted-foreground mb-1.5 block">
                          Or add additional details:
                        </Label>
                        <Input
                          placeholder="Type additional details..."
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
                    </>
                  )}

                {currentQuestion.type === "select" &&
                  currentQuestion.options && (
                    <>
                      <Select
                        value={(responses[currentQuestion.id] as string) || ""}
                        onValueChange={(value) =>
                          setResponses((prev) => ({
                            ...prev,
                            [currentQuestion.id]: value,
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select an option..." />
                        </SelectTrigger>
                        <SelectContent>
                          {currentQuestion.options.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* Always show free-form text input */}
                      <div className="pt-2 border-t border-border/50">
                        <Label className="text-xs text-muted-foreground mb-1.5 block">
                          Or provide your own answer:
                        </Label>
                        <Input
                          placeholder="Type a custom answer..."
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
                    </>
                  )}
              </div>
            </div>

            <div className="flex justify-end">
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
