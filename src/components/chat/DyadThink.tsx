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

  return (
    <div
      className={`relative bg-muted dark:bg-white/5 backdrop-blur-md hover:bg-muted/80 dark:hover:bg-white/10 rounded-lg px-3 py-2.5 border my-2 cursor-pointer transition-all min-h-[42px] ${
        inProgress ? "border-purple-500/50" : "border-border dark:border-white/10"
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
        className="absolute top-2.5 left-3 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-purple-400 bg-purple-500/10 backdrop-blur-sm border border-purple-500/20"
        style={{ zIndex: 1 }}
      >
        <Brain size={12} className="text-purple-400" />
        <span>Thinking</span>
        {inProgress && (
          <Loader size={10} className="ml-1 text-purple-400 animate-spin" />
        )}
      </div>

      {/* Indicator icon */}
      <div className="absolute top-2.5 right-3 p-1 text-muted-foreground dark:text-white/40">
        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>

      {/* Main content with smooth transition */}
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isExpanded ? "none" : "0px",
          opacity: isExpanded ? 1 : 0,
          paddingTop: isExpanded ? "20px" : "0px",
          marginBottom: isExpanded ? "0" : "0",
        }}
      >
        <div className="px-0 text-xs text-muted-foreground dark:text-white/70">
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
