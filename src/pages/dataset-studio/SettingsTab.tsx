import { useState } from "react";
import {
  Shield,
  AlertTriangle,
  Plus,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// Re-use the scraping settings (auth sessions + guardrails) directly
import { SettingsTab as ScrapingSettings } from "../scraping/SettingsTab";
import {
  usePolicies,
  useLicenses,
  usePrivacyRules,
  useViolations,
} from "@/hooks/useDataStudioExtended";

export default function SettingsTab() {
  return (
    <div className="space-y-6">
      {/* Auth & Guardrails from scraping */}
      <ScrapingSettings />

      {/* Content Policies from data-studio */}
      <PolicyPanel />
    </div>
  );
}

function PolicyPanel() {
  const { data: policies } = usePolicies();
  const { data: licenses } = useLicenses();
  const { data: privacyRules } = usePrivacyRules();
  const { data: violations } = useViolations({ resolved: false });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Content Policies
          </CardTitle>
          <CardDescription>Manage content policies and compliance rules</CardDescription>
        </CardHeader>
        <CardContent>
          {policies?.policies && policies.policies.length > 0 ? (
            <div className="space-y-2">
              {policies.policies.map((policy, i) => (
                <div key={i} className="flex items-center justify-between p-2 border rounded">
                  <div>
                    <p className="font-medium">{policy.name}</p>
                    <p className="text-xs text-muted-foreground">{policy.rules.length} rules</p>
                  </div>
                  <Badge variant={policy.enabled ? "default" : "secondary"}>
                    {policy.enabled ? "Active" : "Disabled"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No policies defined</p>
          )}
          <Button variant="outline" className="mt-4">
            <Plus className="h-4 w-4 mr-2" />
            Create Policy
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Violations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {violations?.violations && violations.violations.length > 0 ? (
            <div className="space-y-2">
              {violations.violations.slice(0, 5).map((violation, i) => (
                <div key={i} className="p-2 border rounded bg-red-50 dark:bg-red-950">
                  <p className="text-sm font-medium text-red-700 dark:text-red-300">{violation.policyName}</p>
                  <p className="text-xs text-red-600 dark:text-red-400">{violation.description}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm">No violations detected</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Licenses</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{licenses?.licenses?.length || 0}</p>
            <p className="text-xs text-muted-foreground">Available licenses</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Privacy Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{privacyRules?.rules?.length || 0}</p>
            <p className="text-xs text-muted-foreground">PII detection rules</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
