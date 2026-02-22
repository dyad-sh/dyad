import React, { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CheckCircle2,
  MessageSquareText,
  CircleDot,
  ListChecks,
} from "lucide-react";
import { unescapeXmlAttr, unescapeXmlContent } from "../../../shared/xmlEscape";

interface QAEntry {
  question: string;
  type: string;
  answer: string;
}

interface DyadQuestionnaireProps {
  children?: React.ReactNode;
}

function parseQAEntries(content: string): QAEntry[] {
  const entries: QAEntry[] = [];
  const pattern = /<qa\s+question="([^"]*)"\s+type="([^"]*)">([\s\S]*?)<\/qa>/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    entries.push({
      question: unescapeXmlAttr(match[1]),
      type: unescapeXmlAttr(match[2]),
      answer: unescapeXmlContent(match[3].trim()),
    });
  }
  return entries;
}

const TYPE_META: Record<string, { icon: React.ReactNode; label: string }> = {
  text: {
    icon: <MessageSquareText size={12} />,
    label: "Free text",
  },
  radio: {
    icon: <CircleDot size={12} />,
    label: "Single choice",
  },
  checkbox: {
    icon: <ListChecks size={12} />,
    label: "Multiple choice",
  },
};

export function DyadQuestionnaire({ children }: DyadQuestionnaireProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  const entries = useMemo(
    () => parseQAEntries(typeof children === "string" ? children : ""),
    [children],
  );

  if (entries.length === 0) return null;

  const current = entries[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < entries.length - 1;
  const meta = TYPE_META[current.type];

  return (
    <div className="my-4 border rounded-lg overflow-hidden border-primary/20 bg-primary/5">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="text-primary" size={20} />
          <span className="font-semibold text-foreground">
            Questionnaire Responses
          </span>
          <span className="flex items-center text-xs text-primary px-2 py-0.5 bg-primary/10 rounded-md font-medium">
            {entries.length} answered
          </span>
        </div>
        <CheckCircle2 className="size-4 text-green-600 dark:text-green-500 shrink-0" />
      </div>

      {/* Question/Answer content */}
      <div className="px-4 pb-4">
        <div className="rounded-lg bg-(--background-lightest) dark:bg-zinc-900/60 border border-border/40 overflow-hidden">
          {/* Question */}
          <div className="px-3.5 pt-3 pb-2.5 bg-muted/40">
            <div className="flex items-center gap-1.5 mb-1.5">
              {meta && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {meta.icon}
                  {meta.label}
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-foreground leading-relaxed">
              {current.question}
            </p>
          </div>

          <div className="h-px bg-border" />

          {/* Answer */}
          <div className="px-3.5 pt-2.5 pb-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Answer
            </p>
            <p className="text-sm text-foreground/90 leading-relaxed">
              {current.answer}
            </p>
          </div>
        </div>

        {/* Navigation */}
        {entries.length > 1 && (
          <div className="flex items-center justify-between mt-3">
            {/* Dot indicators */}
            <div className="flex items-center gap-1.5">
              {entries.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIndex(i)}
                  className={`rounded-full transition-all duration-200 ${
                    i === currentIndex
                      ? "w-5 h-1.5 bg-primary"
                      : "w-1.5 h-1.5 bg-primary/25 hover:bg-primary/40"
                  }`}
                  aria-label={`Go to question ${i + 1}`}
                />
              ))}
            </div>

            {/* Arrow buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentIndex((i) => i - 1)}
                disabled={!hasPrev}
                className="p-1 rounded-md hover:bg-primary/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous question"
              >
                <ChevronLeft size={16} className="text-muted-foreground" />
              </button>
              <span className="text-xs text-muted-foreground tabular-nums min-w-[3ch] text-center">
                {currentIndex + 1}/{entries.length}
              </span>
              <button
                onClick={() => setCurrentIndex((i) => i + 1)}
                disabled={!hasNext}
                className="p-1 rounded-md hover:bg-primary/10 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
                aria-label="Next question"
              >
                <ChevronRight size={16} className="text-muted-foreground" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
