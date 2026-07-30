"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type PendingInviteRow = {
  id: string;
  email: string;
  role: string;
  status: string;
  acceptUrl: string;
};

type Props = {
  orgId: string;
  invites: PendingInviteRow[];
};

export function PendingInvitesTable({ orgId, invites }: Props) {
  const router = useRouter();
  const [revoking, setRevoking] = useState<string | null>(null);

  async function revoke(inviteId: string) {
    setRevoking(inviteId);
    try {
      await fetch(`/api/orgs/${orgId}/invites/${inviteId}`, {
        method: "DELETE",
      });
      router.refresh();
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
      <Table data-testid="invites-table">
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Accept link</TableHead>
            <TableHead className="w-[100px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {invites.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                No pending invites.
              </TableCell>
            </TableRow>
          ) : (
            invites.map((invite) => (
              <TableRow
                key={invite.id}
                data-testid="invite-row"
                data-invite-email={invite.email}
              >
                <TableCell className="font-medium">{invite.email}</TableCell>
                <TableCell>{invite.role}</TableCell>
                <TableCell data-testid="invite-status">{invite.status}</TableCell>
                <TableCell>
                  <span
                    data-testid="invite-link"
                    className="break-all font-mono text-xs text-muted-foreground"
                  >
                    {invite.acceptUrl}
                  </span>
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="invite-revoke"
                    disabled={revoking === invite.id}
                    onClick={() => revoke(invite.id)}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
