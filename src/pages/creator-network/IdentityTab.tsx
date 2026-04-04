import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FederationClient } from "@/ipc/federation_client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Users,
  Shield,
  Key,
  Network,
  HardDrive,
  TrendingUp,
  RefreshCw,
  Plus,
  Copy,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import type {
  DecentralizedIdentity,
  Peer,
  FederationStats,
  BootstrapPeerEntry,
} from "@/types/federation_types";

export default function IdentityTab() {
  const queryClient = useQueryClient();
  const [showIdentityDialog, setShowIdentityDialog] = useState(false);
  const [identityForm, setIdentityForm] = useState({
    displayName: "",
    storeName: "",
    creatorId: "",
    password: "",
    confirmPassword: "",
  });
  const [bootstrapForm, setBootstrapForm] = useState({
    peerId: "",
    displayName: "",
    did: "",
    address: "",
    notes: "",
  });

  const { data: identity, isLoading: identityLoading } = useQuery({
    queryKey: ["federation-identity"],
    queryFn: () => FederationClient.getIdentity(),
  });

  const { data: stats } = useQuery({
    queryKey: ["federation-stats"],
    queryFn: () => FederationClient.getStats(),
    refetchInterval: 30000,
  });

  const { data: peers = [] } = useQuery({
    queryKey: ["federation-peers"],
    queryFn: () => FederationClient.getPeers(),
  });

  const { data: bootstrapPeers = [] } = useQuery<BootstrapPeerEntry[]>({
    queryKey: ["federation-bootstrap-peers"],
    queryFn: () => FederationClient.listBootstrapPeers(),
  });

  const { data: connectedPeers = [] } = useQuery({
    queryKey: ["federation-connected-peers"],
    queryFn: () => FederationClient.getConnectedPeers(),
    refetchInterval: 10000,
  });

  // Show identity creation if no identity
  useEffect(() => {
    if (!identityLoading && !identity) {
      setShowIdentityDialog(true);
    }
  }, [identity, identityLoading]);

  const createIdentityMutation = useMutation({
    mutationFn: async () => {
      if (identityForm.password !== identityForm.confirmPassword) {
        throw new Error("Passwords do not match");
      }
      return FederationClient.createIdentity(
        identityForm.displayName,
        identityForm.password,
        identityForm.storeName || undefined,
        identityForm.creatorId || undefined
      );
    },
    onSuccess: () => {
      toast.success("Identity created! Welcome to the creator network.");
      queryClient.invalidateQueries({ queryKey: ["federation-identity"] });
      setShowIdentityDialog(false);
      setIdentityForm({
        displayName: "",
        storeName: "",
        creatorId: "",
        password: "",
        confirmPassword: "",
      });
    },
    onError: (error) => {
      toast.error(`Failed to create identity: ${error.message}`);
    },
  });

  const connectPeerMutation = useMutation({
    mutationFn: (peerId: string) => FederationClient.connectPeer(peerId),
    onSuccess: () => {
      toast.success("Connected to peer!");
      queryClient.invalidateQueries({ queryKey: ["federation-connected-peers"] });
    },
  });

  const addBootstrapPeerMutation = useMutation({
    mutationFn: () => {
      if (!bootstrapForm.peerId) {
        throw new Error("Peer ID is required");
      }
      return FederationClient.addBootstrapPeer({
        id: bootstrapForm.peerId,
        did: bootstrapForm.did || undefined,
        display_name: bootstrapForm.displayName || undefined,
        address: bootstrapForm.address || undefined,
        notes: bootstrapForm.notes || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Bootstrap peer saved");
      queryClient.invalidateQueries({ queryKey: ["federation-bootstrap-peers"] });
      setBootstrapForm({ peerId: "", displayName: "", did: "", address: "", notes: "" });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save bootstrap peer");
    },
  });

  const removeBootstrapPeerMutation = useMutation({
    mutationFn: (peerId: string) => FederationClient.removeBootstrapPeer(peerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["federation-bootstrap-peers"] });
    },
  });

  const importBootstrapPeerMutation = useMutation({
    mutationFn: (peerId: string) => FederationClient.importBootstrapPeer(peerId),
    onSuccess: () => {
      toast.success("Peer imported");
      queryClient.invalidateQueries({ queryKey: ["federation-peers"] });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Identity Card */}
        {identity && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-cyan-500" />
                Your Identity
              </CardTitle>
              <CardDescription>
                Self-sovereign decentralized identity on the creator network
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="bg-cyan-500/20 text-cyan-600 text-lg">
                    {identity.display_name?.slice(0, 2).toUpperCase() || "??"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 space-y-2">
                  <div>
                    <h3 className="text-lg font-semibold">{identity.display_name}</h3>
                    {identity.store_name && (
                      <p className="text-sm text-muted-foreground">{identity.store_name}.joy</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                      {identity.did}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(identity.did)}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    {identity.creator_id && <span>Creator: {identity.creator_id}</span>}
                    <span>Created: {new Date(identity.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Users className="w-8 h-8 text-cyan-500" />
                <div>
                  <p className="text-2xl font-bold">{stats?.online_peers ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Connected Peers</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <HardDrive className="w-8 h-8 text-teal-500" />
                <div>
                  <p className="text-2xl font-bold">{stats?.active_listings ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Active Listings</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-8 h-8 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{stats?.total_transactions ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Transactions</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Network className="w-8 h-8 text-green-500" />
                <div>
                  <p className="text-2xl font-bold capitalize">{stats?.network_health ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">Network Health</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Connected Peers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Connected Peers
            </CardTitle>
            <CardDescription>
              Currently connected peers on the network ({connectedPeers.length})
            </CardDescription>
          </CardHeader>
          <CardContent>
            {connectedPeers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No peers connected. Add bootstrap peers below to discover the network.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {connectedPeers.map((peer) => (
                  <div
                    key={peer.id}
                    className="flex items-center gap-3 p-3 rounded-lg border"
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="text-xs">
                        {peer.did.display_name?.slice(0, 2).toUpperCase() || "P"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {peer.did.display_name || peer.id.slice(0, 16)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {peer.id.slice(0, 24)}...
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        peer.status === "online"
                          ? "border-green-500 text-green-500"
                          : "border-gray-400 text-gray-400"
                      }
                    >
                      {peer.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Discover Peers */}
        {peers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Discover Peers</CardTitle>
              <CardDescription>
                Known peers not yet connected ({peers.filter((p) => !p.connected).length})
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {peers
                  .filter((p) => !p.connected)
                  .slice(0, 8)
                  .map((peer) => (
                    <div
                      key={peer.id}
                      className="flex items-center gap-3 p-3 rounded-lg border"
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="text-xs">
                          {peer.did.display_name?.slice(0, 2).toUpperCase() || "P"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {peer.did.display_name || peer.id.slice(0, 16)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {peer.capabilities.join(", ")}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => connectPeerMutation.mutate(peer.id)}
                        disabled={connectPeerMutation.isPending}
                      >
                        Connect
                      </Button>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bootstrap Peers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="w-5 h-5" />
              Bootstrap Peers
            </CardTitle>
            <CardDescription>
              Seed peers for network discovery. Add peers you trust to expand your network.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Peer ID *</Label>
                <Input
                  value={bootstrapForm.peerId}
                  onChange={(e) =>
                    setBootstrapForm((prev) => ({ ...prev, peerId: e.target.value }))
                  }
                  placeholder="12D3KooW..."
                />
              </div>
              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input
                  value={bootstrapForm.displayName}
                  onChange={(e) =>
                    setBootstrapForm((prev) => ({ ...prev, displayName: e.target.value }))
                  }
                  placeholder="My trusted peer"
                />
              </div>
              <div className="space-y-2">
                <Label>DID</Label>
                <Input
                  value={bootstrapForm.did}
                  onChange={(e) =>
                    setBootstrapForm((prev) => ({ ...prev, did: e.target.value }))
                  }
                  placeholder="did:joy:..."
                />
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input
                  value={bootstrapForm.address}
                  onChange={(e) =>
                    setBootstrapForm((prev) => ({ ...prev, address: e.target.value }))
                  }
                  placeholder="/ip4/..."
                />
              </div>
            </div>
            <Button
              onClick={() => addBootstrapPeerMutation.mutate()}
              disabled={!bootstrapForm.peerId || addBootstrapPeerMutation.isPending}
            >
              <Plus className="w-4 h-4 mr-2" />
              Save Bootstrap Peer
            </Button>

            {/* Saved Bootstrap Peers */}
            {bootstrapPeers.length > 0 && (
              <div className="space-y-2 pt-2">
                <Label className="text-muted-foreground">Saved Bootstrap Peers</Label>
                {bootstrapPeers.map((bp) => (
                  <div
                    key={bp.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {bp.display_name || bp.id.slice(0, 24)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {bp.id}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => importBootstrapPeerMutation.mutate(bp.id)}
                        disabled={importBootstrapPeerMutation.isPending}
                      >
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Import
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeBootstrapPeerMutation.mutate(bp.id)}
                      >
                        <XCircle className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Identity Creation Dialog */}
        <Dialog open={showIdentityDialog} onOpenChange={setShowIdentityDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                Create Your Identity
              </DialogTitle>
              <DialogDescription>
                Create a decentralized identity to join the creator network.
                Your identity is self-sovereign — only you control it.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input
                  placeholder="How others will see you"
                  value={identityForm.displayName}
                  onChange={(e) =>
                    setIdentityForm({ ...identityForm, displayName: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Store Name (.joy)</Label>
                <Input
                  placeholder="yourstore"
                  value={identityForm.storeName}
                  onChange={(e) =>
                    setIdentityForm({ ...identityForm, storeName: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Creator ID</Label>
                <Input
                  placeholder="creator-001"
                  value={identityForm.creatorId}
                  onChange={(e) =>
                    setIdentityForm({ ...identityForm, creatorId: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  placeholder="Encrypts your private key"
                  value={identityForm.password}
                  onChange={(e) =>
                    setIdentityForm({ ...identityForm, password: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Confirm Password</Label>
                <Input
                  type="password"
                  placeholder="Confirm your password"
                  value={identityForm.confirmPassword}
                  onChange={(e) =>
                    setIdentityForm({ ...identityForm, confirmPassword: e.target.value })
                  }
                />
              </div>

              <div className="bg-muted p-3 rounded-lg text-sm">
                <p className="font-medium mb-1">Important</p>
                <p className="text-muted-foreground">
                  Your private key will be encrypted with this password.
                  If you lose your password, you cannot recover your identity.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={() => createIdentityMutation.mutate()}
                disabled={
                  !identityForm.displayName ||
                  !identityForm.password ||
                  createIdentityMutation.isPending
                }
              >
                {createIdentityMutation.isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Shield className="w-4 h-4 mr-2" />
                    Create Identity
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}
