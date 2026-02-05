import { Shield, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { useAuthConfig } from "@/hooks/useAuthConfig";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface AuthSectionProps {
  projectId: string;
  organizationSlug: string | null;
}

export function AuthSection({ projectId, organizationSlug }: AuthSectionProps) {
  const {
    data: config,
    isLoading,
    error,
  } = useAuthConfig({
    projectId,
    organizationSlug,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="p-4 space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Failed to load auth configuration</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <Shield className="w-12 h-12 text-muted-foreground" />
        <div>
          <h3 className="text-lg font-medium mb-2">No Configuration</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Auth configuration is not available for this project.
          </p>
        </div>
      </div>
    );
  }

  const providers = config.external_providers ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
        <Shield className="h-4 w-4" />
        <h3 className="text-sm font-medium">Authentication Settings</h3>
      </div>

      <div className="flex-1 overflow-auto">
        {/* General Settings */}
        <div className="px-4 py-3 border-b border-border">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            General
          </h4>
          <div className="space-y-2">
            {config.site_url && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Site URL</span>
                <span className="font-mono text-xs">{config.site_url}</span>
              </div>
            )}
            {config.jwt_expiry !== undefined && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">JWT Expiry</span>
                <span className="font-mono text-xs">{config.jwt_expiry}s</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sign-ups</span>
              <Badge
                variant={config.disable_signup ? "destructive" : "secondary"}
              >
                {config.disable_signup ? "Disabled" : "Enabled"}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Email Auto-confirm</span>
              <Badge
                variant={config.mailer_autoconfirm ? "secondary" : "outline"}
              >
                {config.mailer_autoconfirm ? "On" : "Off"}
              </Badge>
            </div>
          </div>
        </div>

        {/* Auth Providers */}
        <div className="px-4 py-3">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Providers ({providers.length})
          </h4>
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No external providers configured.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="text-xs">Provider</TableHead>
                  <TableHead className="text-xs w-[100px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((provider) => (
                  <TableRow key={provider.name}>
                    <TableCell className="text-sm capitalize">
                      {provider.name}
                    </TableCell>
                    <TableCell>
                      {provider.enabled ? (
                        <span className="flex items-center gap-1.5 text-xs text-green-600">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Enabled
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <XCircle className="h-3.5 w-3.5" />
                          Disabled
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
