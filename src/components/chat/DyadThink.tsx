import React, { useState, useEffect } from "react";
import { Brain, ChevronDown, ChevronUp, Loader } from "lucide-react";
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

  // Check if content matches token savings format
  const tokenSavingsMatch =
    typeof children === "string"
      ? children.match(
          /^dyad-token-savings\?original-tokens=([0-9.]+)&smart-context-tokens=([0-9.]+)$/,
        )
      : null;

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

  // Collapse when transitioning from in-progress to not-in-progress
  useEffect(() => {
    if (!inProgress && isExpanded) {
      setIsExpanded(false);
    }
  }, [inProgress]);

  return (
    <div
      className={`relative bg-(--background-lightest) dark:bg-zinc-900 hover:bg-(--background-lighter) rounded-lg px-4 py-2 border my-2 cursor-pointer ${
        inProgress ? "border-purple-500" : "border-border"
      }`}
      onClick={() => setIsExpanded(!isExpanded)}
      role="button"
      aria-expanded={isExpanded}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setIsExpanded(!isExpanded);
        }
      }}
    >
      {/* Top-left label badge */}
      <div
        className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-purple-500 bg-white dark:bg-zinc-900"
        style={{ zIndex: 1 }}
      >
        <Brain size={16} className="text-purple-500" />
        <span>Thinking</span>
        {inProgress && (
          <Loader size={14} className="ml-1 text-purple-500 animate-spin" />
        )}
      </div>

      {/* Indicator icon */}
      <div className="absolute top-2 right-2 p-1 text-gray-500">
        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      {/* Main content with smooth transition */}
      <div
        className="pt-6 overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isExpanded ? "none" : "0px",
          opacity: isExpanded ? 1 : 0,
          marginBottom: isExpanded ? "0" : "-6px", // Compensate for padding
        }}
      >
        <div className="px-0 text-sm text-gray-600 dark:text-gray-300">
          {typeof children === "string" ? (
            <VanillaMarkdownParser content={children} />
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
};
