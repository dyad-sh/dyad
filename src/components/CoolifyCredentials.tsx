import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";

/**
 * The way into a server Dyad set up.
 *
 * Dyad invents the admin password and mints the API token, so it is the only
 * thing that knows either. Without somewhere to read them, a machine the user
 * owns has no way in they can see.
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
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);
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
          onClick={() => {
            navigator.clipboard
              .writeText(value)
              .then(() => {
                setCopied(true);
                clearTimeout(resetTimer.current);
                resetTimer.current = setTimeout(() => setCopied(false), 2000);
              })
              .catch(showError);
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

  const { instance, server } = credentials;
  // An instance connected by pasting a token has no account Dyad created and
  // no server it built, so there is nothing here worth a heading.
  if (!instance && !server) return null;
  // The usual case: Dyad set the server up and is connected to it. Merged on
  // the address matching exactly, never on a guess at two spellings of one
  // machine — guessing wrong the other way shows two blocks with two correct
  // addresses, which is a moment's confusion rather than a wrong password.
  const isOneServer =
    instance !== null && server !== null && instance.url === server.url;

  return (
    <div className="space-y-2 text-sm" data-testid="coolify-credentials">
      {/* Kept inside so a caller cannot leave a heading over nothing when
          there is nothing to show. */}
      {showTitle && (
        <div className="border-t pt-3 font-semibold">Your Coolify server</div>
      )}

      {isOneServer ? (
        <>
          <Field label="Address" value={instance.url} />
          <Field label="Email" value={server.email} />
          {server.password && (
            <Field label="Password" value={server.password} secret />
          )}
          {instance.apiToken && (
            <Field label="API token" value={instance.apiToken} secret />
          )}
        </>
      ) : (
        <>
          {server && (
            <div className="space-y-2" data-testid="coolify-credentials-server">
              <div className="text-muted-foreground text-xs">
                The server Dyad set up
              </div>
              <Field label="Address" value={server.url} />
              <Field label="Email" value={server.email} />
              {server.password && (
                <Field label="Password" value={server.password} secret />
              )}
            </div>
          )}
          {instance && (
            <div
              className="space-y-2"
              data-testid="coolify-credentials-instance"
            >
              <div className="text-muted-foreground text-xs">
                The Coolify Dyad is connected to
              </div>
              <Field label="Address" value={instance.url} />
              {instance.apiToken && (
                <Field label="API token" value={instance.apiToken} secret />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
