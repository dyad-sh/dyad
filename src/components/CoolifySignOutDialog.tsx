import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { CoolifyCredentials } from "@/components/CoolifyCredentials";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * The last look at credentials Dyad is about to forget.
 *
 * Signing out clears the instance outright rather than keeping a copy around
 * for an instance nothing is connected to. That is only fair if the user gets
 * to take the details with them first, so they are on screen here with their
 * copy buttons, behind an acknowledgement rather than a plain confirm.
 */
export function CoolifySignOutDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  // Ticked once is not ticked forever: every open starts from unticked, so
  // the acknowledgement is about this sign-out. Keyed to `open` rather than
  // done on the way out, because closing is not always the user's doing.
  useEffect(() => {
    if (!open) setAcknowledged(false);
  }, [open]);

  // Shares a key with the fields below, so opening this asks once. Only read
  // here to decide whether the password gets a warning of its own.
  const {
    data: credentials,
    isPending,
    isError,
  } = useQuery({
    queryKey: queryKeys.coolify.credentials,
    queryFn: () => ipc.coolifySetup.revealCredentials(),
    gcTime: 0,
    enabled: open,
  });
  // A tick over an empty panel is not the acknowledgement this asks for, so
  // nothing can be confirmed until the read has answered. `enabled` leaves the
  // query pending while the dialog is closed, which reads the same here.
  const answered = !isPending || isError;
  // What the panel below reports: a read that failed with nothing already in
  // hand. A failed refetch over details it can still show is not one, and the
  // line below would then hang off nothing.
  const readFailed = isError && !credentials;
  // Held but unreadable, which the panel below cannot show because there is
  // no value to put on screen. Saying so beats a silently missing row.
  const passwordIsLocked =
    credentials?.server !== null &&
    credentials?.server !== undefined &&
    credentials.server.password === null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="coolify-sign-out-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out of Coolify?</AlertDialogTitle>
          <AlertDialogDescription>
            Dyad will forget the details below. Your server keeps running and
            your apps keep their settings.
            {credentials?.server?.password
              ? " Dyad made this password up and is the only thing holding it — Coolify cannot show it to you again."
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isPending && !isError && (
          <div className="text-muted-foreground text-sm">
            Looking up what Dyad has stored…
          </div>
        )}

        <CoolifyCredentials />

        {passwordIsLocked && (
          <div
            className="text-destructive text-sm"
            data-testid="coolify-sign-out-locked-password"
          >
            It goes when you sign out, unread.
          </div>
        )}

        {readFailed && (
          <div
            className="text-destructive text-sm"
            data-testid="coolify-sign-out-unreadable"
          >
            Signing out forgets it anyway.
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
            data-testid="coolify-sign-out-acknowledge"
          />
          I have saved anything I need from above
        </label>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {/* Closes as it fires — it is a Close underneath — so there is no
              pending state to show here. The button that opened this stays on
              screen and carries that. */}
          <AlertDialogAction
            disabled={!acknowledged || !answered}
            onClick={onConfirm}
          >
            Sign out
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
