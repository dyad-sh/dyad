import React from "react";
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

interface CommunityCodeConsentDialogProps {
  isOpen: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

export const CommunityCodeConsentDialog: React.FC<
  CommunityCodeConsentDialogProps
> = ({ isOpen, onAccept, onCancel }) => {
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Community Code Notice</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              This code was created by a Dyad community member, not our core
              team.
            </p>
            <p>
              Community code can be very helpful, but since it's built
              independently, it may have bugs, security risks, or could cause
              issues with your system. We can't provide official support if
              problems occur.
            </p>
            <p>
              We recommend reviewing the code on GitHub first. Only proceed if
              you're comfortable with these risks.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onAccept}>Accept</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
