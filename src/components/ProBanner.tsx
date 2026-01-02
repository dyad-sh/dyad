/**
 * Feature Banner Component
 * Highlights JoyCreate's free features - all Pro features unlocked
 */

import { Link } from "@tanstack/react-router";
import { Bot, Workflow, Sparkles, Zap } from "lucide-react";

/**
 * Main banner component - shows feature highlights
 */
export function ProBanner() {
  return (
    <div className="mt-6 max-w-2xl mx-auto">
      <FeatureHighlightBanner />
    </div>
  );
}

/**
 * Feature highlight banner showing JoyCreate's capabilities
 */
function FeatureHighlightBanner() {
  return (
    <div className="w-full py-4 rounded-xl ghost-card ghost-gradient">
      <div className="text-center mb-3">
        <p className="text-sm font-medium text-muted-foreground">
          ✨ All features unlocked
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4">
        <FeatureCard
          to="/agents"
          icon={<Bot className="h-5 w-5 text-violet-500" />}
          title="Agents"
          description="Build AI agents"
        />
        <FeatureCard
          to="/workflows"
          icon={<Workflow className="h-5 w-5 text-blue-500" />}
          title="Workflows"
          description="Automate tasks"
        />
        <FeatureCard
          to="/local-models"
          icon={<Zap className="h-5 w-5 text-amber-500" />}
          title="Local AI"
          description="Private inference"
        />
        <FeatureCard
          to="/chat"
          icon={<Sparkles className="h-5 w-5 text-pink-500" />}
          title="Smart Context"
          description="Faster coding"
        />
      </div>
    </div>
  );
}

interface FeatureCardProps {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ to, icon, title, description }: FeatureCardProps) {
  return (
    <Link
      to={to}
      className="flex flex-col items-center gap-1 p-3 rounded-lg bg-background/50 border border-border/50 hover:border-border hover:shadow-sm transition-all cursor-pointer"
    >
      {icon}
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </Link>
  );
}

// Keep legacy exports for compatibility but they do nothing now
export function ManageDyadProButton() {
  return null;
}

export function SetupDyadProButton() {
  return null;
}

export function AiAccessBanner() {
  return null;
}

export function SmartContextBanner() {
  return null;
}

export function TurboBanner() {
  return null;
}
