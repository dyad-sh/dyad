/**
 * OpenClaw CNS Page
 * 
 * Full dashboard page for the Central Nervous System.
 * 
 * 🦞 EXFOLIATE! EXFOLIATE!
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Brain } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { CNSDashboard } from "@/components/openclaw/CNSDashboard";

export default function CNSPage() {
  const router = useRouter();

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="mx-auto">
        <Button
          onClick={() => router.history.back()}
          variant="outline"
          size="sm"
          className="flex items-center gap-2 mb-6 border-border/50 hover:border-primary/30 hover:bg-primary/5 transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          Go Back
        </Button>
        
        {/* Enhanced Header */}
        <div className="mb-8 p-6 rounded-2xl bg-gradient-to-r from-primary/10 via-purple-500/10 to-violet-500/10 border border-primary/20">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-primary/20 via-purple-500/20 to-violet-500/20 border border-primary/20">
              <Brain className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-primary via-purple-600 to-violet-600 bg-clip-text text-transparent flex items-center gap-2">
                OpenClaw CNS
                <span className="text-base">🦞</span>
              </h1>
              <p className="text-muted-foreground text-sm">
                Central Nervous System • Ollama + n8n Integration
              </p>
            </div>
          </div>
        </div>

        {/* CNS Dashboard */}
        <CNSDashboard />
      </div>
    </div>
  );
}
