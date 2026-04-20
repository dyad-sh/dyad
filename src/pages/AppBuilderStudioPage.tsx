/**
 * Enhanced App Builder Studio Page
 *
 * Route: /app-builder
 *
 * The next-generation app building experience with:
 * - 8 build modes (Chat, Agent, Plan, Visual, Code, Debug, Refactor, Test)
 * - Browser testing, design systems, security scanning
 * - Analytics, knowledge base, environments
 * - Database editor, API builder, form builder
 * - SEO, templates, marketplace, Web3, mobile export
 */

import { EnhancedAppBuilderStudio } from "@/components/app-builder/EnhancedAppBuilderStudio";

export default function AppBuilderStudioPage() {
  return (
    <div className="h-full">
      <EnhancedAppBuilderStudio />
    </div>
  );
}
