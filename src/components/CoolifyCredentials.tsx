import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * The way into a server Dyad set up.
 *
 * Dyad invents the admin password and mints the API token, so it is the only
 * thing that knows either. Without somewhere to read them, signing out of
 * Coolify in Dyad locks the user out of a machine they own.
 *
 * Shown rather than hidden behind a control: these belong to the user, and
 * making them click to discover that Dyad even has them means most people
 * never find out. The values themselves stay masked until asked for, which is
 * the part worth a click.
 */

function Field({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <code
          className="max-w-[18rem] truncate text-xs"
          data-testid={`coolify-field-${id}`}
        >
          {!secret || shown ? value : "•".repeat(Math.min(value.length, 16))}
        </code>
        {secret && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? `Hide ${label}` : `Show ${label}`}
          >
            {shown ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

export function CoolifyCredentials({
  showTitle,
}: { showTitle?: boolean } = {}) {
  // Not held after this leaves the screen: these are the keys to the user's
  // server, and there is no reason for them to sit in a cache once nothing is
  // showing them.
  const { data: credentials } = useQuery({
    queryKey: queryKeys.coolify.credentials,
    queryFn: () => ipc.coolifySetup.revealCredentials(),
    gcTime: 0,
  });

  if (!credentials) return null;

  const { dashboardUrl, adminEmail, adminPassword, apiToken } = credentials;
  // An instance connected by pasting a token has no account Dyad created and
  // no address it chose, so there is nothing here worth a heading.
  if (!dashboardUrl && !adminEmail && !adminPassword && !apiToken) return null;

  return (
    <div className="space-y-2 text-sm" data-testid="coolify-credentials">
      {/* Kept inside so a caller cannot leave a heading over nothing when
          there is nothing to show — and so the wording follows which server
          these turned out to describe, which only this knows. */}
      {showTitle && (
        <div className="border-t pt-3 font-semibold">
          {credentials.isPreviousConnection
            ? "Previous Coolify connection"
            : "Your new Coolify server"}
        </div>
      )}
      {dashboardUrl && <Field label="Address" value={dashboardUrl} />}
      {adminEmail && <Field label="Email" value={adminEmail} />}
      {adminPassword && <Field label="Password" value={adminPassword} secret />}
      {apiToken && <Field label="API token" value={apiToken} secret />}
    </div>
  );
}
