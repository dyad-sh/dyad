import React, { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { VanillaMarkdownParser } from "./DyadMarkdownParser";
import { CustomTagState } from "./stateTypes";
import { DyadTokenSavings } from "./DyadTokenSavings";

interface DyadThinkProps {
  node?: any;
  children?: React.ReactNode;
}

export const DyadThink: React.FC<DyadThinkProps> = ({ children, node }) => {
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const [isExpanded, setIsExpanded] = useState(inProgress);
  const [hasExpanded, setHasExpanded] = useState(false);

  useEffect(() => {
    if (isExpanded && !hasExpanded) {
      setHasExpanded(true);
    }
  }, [isExpanded]);

  // Check if content matches token savings format
  const tokenSavingsMatch =
    typeof children === "string"
      ? children.match(
          /^dyad-token-savings\?original-tokens=([0-9.]+)&smart-context-tokens=([0-9.]+)$/,
        )
      : null;

  // Collapse when transitioning from in-progress to not-in-progress
  useEffect(() => {
    if (!inProgress && isExpanded) {
      setIsExpanded(false);
    }
  }, [inProgress]);

  // If it's token savings format, render DyadTokenSavings component
  if (tokenSavingsMatch) {
    const originalTokens = parseFloat(tokenSavingsMatch[1]);
    const smartContextTokens = parseFloat(tokenSavingsMatch[2]);
    return (
      <DyadTokenSavings
        originalTokens={originalTokens}
        smartContextTokens={smartContextTokens}
      />
    );
  }

  // Extract the first line for preview when collapsed
  const firstLine =
    typeof children === "string"
      ? (children
          .split("\n")
          .find((line) => line.trim() !== "")
          ?.trim()
          .replace(/^\*{1,2}/, "")
          .replace(/\*{1,2}$/, "") ?? "")
      : "";

  return (
    <div className="my-1">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 py-1 group cursor-pointer"
      >
        <ChevronRight
          size={14}
          className={`shrink-0 text-muted-foreground/50 transition-transform duration-200 ${
            isExpanded ? "rotate-90" : ""
          }`}
        />
        <span className="text-[13px] font-medium text-foreground/70 group-hover:text-foreground transition-colors">
          {inProgress ? "Thinking…" : "Thought"}
        </span>
        {!isExpanded && firstLine && (
          <span className="ml-0.5 truncate text-[13px] text-muted-foreground/85 max-w-md">
            {firstLine}
          </span>
        )}
      </button>

      {/* Expandable content */}
      <div
        className={`grid transition-all duration-200 ease-in-out ${
          isExpanded
            ? "grid-rows-[1fr] opacity-100"
            : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="flex ml-[7px]">
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="relative shrink-0 w-6 cursor-pointer group/border"
              aria-label="Collapse thinking"
            >
              <span className="absolute left-0 top-0 bottom-0 w-px bg-border/60 group-hover/border:w-[2px] group-hover/border:bg-foreground/40 transition-all" />
            </button>
            <div className="text-sm text-muted-foreground pb-2 pt-1">
              {hasExpanded ? (
                typeof children === "string" ? (
                  <VanillaMarkdownParser content={children} />
                ) : (
                  children
                )
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
