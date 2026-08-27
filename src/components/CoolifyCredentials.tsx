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
  idPrefix,
}: {
  label: string;
  value: string;
  secret?: boolean;
  /**
   * Told apart from the same label in the other block, and only when both
   * are on screen. Both carry an address, so an id naming just the label
   * would be two things at once — which any lookup for it reaches
   * ambiguously. One block alone has nothing to be confused with.
   */
  idPrefix?: string;
}) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);
  const id = `${idPrefix ? `${idPrefix}-` : ""}${label
    .toLowerCase()
    .replace(/\s+/g, "-")}`;
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

/**
 * Said rather than left blank.
 *
 * readSettings drops a password it cannot decrypt and keeps the account, so
 * the absence is Dyad holding one it cannot open — not a server that never
 * had one. Left to the row simply not appearing, the two look identical, and
 * only one of them makes signing out a safe thing to do next.
 */
function LockedPassword() {
  return (
    <p
      className="text-destructive text-sm"
      data-testid="coolify-credentials-locked-password"
    >
      Dyad is holding an admin password for this server but cannot read it on
      this machine.
    </p>
  );
}

export function CoolifyCredentials({
  showTitle,
}: { showTitle?: boolean } = {}) {
  // Not held after this leaves the screen: these are the keys to the user's
  // server, and there is no reason for them to sit in a cache once nothing is
  // showing them.
  const { data: credentials, isError } = useQuery({
    queryKey: queryKeys.coolify.credentials,
    queryFn: () => ipc.coolifySetup.revealCredentials(),
    gcTime: 0,
  });

  // Said rather than left blank. Callers introduce this panel as the details
  // they are about to show, so rendering nothing at all reads as Dyad holding
  // nothing rather than as a read that did not answer.
  //
  // Only when there is nothing to show. A read that fails over details already
  // in hand — the refetch on window focus, which production does not retry —
  // still leaves them readable, and taking a password Dyad holds the only copy
  // of off the screen to report the refresh would be the worse trade.
  if (isError && !credentials) {
    return (
      <p
        className="text-destructive text-sm"
        data-testid="coolify-credentials-unreadable"
      >
        Dyad could not read what it has stored for this Coolify.
      </p>
    );
  }
  if (!credentials) return null;

  const { instance, server } = credentials;
  // Nothing stored at all — signed out, or never connected. A panel of blanks
  // would read as something having failed.
  if (!instance && !server) return null;
  // The usual case: Dyad set the server up and is connected to it. Merged on
  // the address matching exactly, never on a guess at two spellings of one
  // machine — guessing wrong the other way shows two blocks with two correct
  // addresses, which is a moment's confusion rather than a wrong password.
  const isOneServer =
    instance !== null && server !== null && instance.url === server.url;
  // Only when there are two blocks to tell apart. Over a lone block they name
  // something nothing is being distinguished from.
  const showsBoth = instance !== null && server !== null;

  return (
    <div className="space-y-2 text-sm" data-testid="coolify-credentials">
      {/* Kept inside so a caller cannot leave a heading over nothing when
          there is nothing to show. */}
      {showTitle && (
        <div className="border-t pt-3 font-semibold">Your Coolify server</div>
      )}

      {/* A password Dyad holds but cannot decrypt comes back absent, which
          renders as a server that never had one — and the way that reads,
          the obvious next move is the sign-out that discards it for good.
          The dialog says this; nowhere else did. */}
      {isOneServer ? (
        <>
          <Field label="Address" value={instance.url} />
          <Field label="Email" value={server.email} />
          {server.password ? (
            <Field label="Password" value={server.password} secret />
          ) : (
            <LockedPassword />
          )}
          {instance.apiToken && (
            <Field label="API token" value={instance.apiToken} secret />
          )}
        </>
      ) : (
        <>
          {server && (
            <div className="space-y-2" data-testid="coolify-credentials-server">
              {showsBoth && (
                <div className="text-muted-foreground text-xs">
                  The server Dyad set up
                </div>
              )}
              <Field
                label="Address"
                value={server.url}
                idPrefix={showsBoth ? "server" : undefined}
              />
              <Field
                label="Email"
                value={server.email}
                idPrefix={showsBoth ? "server" : undefined}
              />
              {server.password ? (
                <Field
                  label="Password"
                  value={server.password}
                  secret
                  idPrefix={showsBoth ? "server" : undefined}
                />
              ) : (
                <LockedPassword />
              )}
            </div>
          )}
          {instance && (
            <div
              className="space-y-2"
              data-testid="coolify-credentials-instance"
            >
              {showsBoth && (
                <div className="text-muted-foreground text-xs">
                  The Coolify Dyad is connected to
                </div>
              )}
              <Field
                label="Address"
                value={instance.url}
                idPrefix={showsBoth ? "instance" : undefined}
              />
              {instance.apiToken && (
                <Field
                  label="API token"
                  value={instance.apiToken}
                  secret
                  idPrefix={showsBoth ? "instance" : undefined}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
