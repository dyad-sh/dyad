/**
 * Federation P2P Marketplace Page
 * Decentralized peer-to-peer asset trading
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FederationClient } from "@/ipc/federation_client";
import { NFTClient } from "@/ipc/nft_client";
import { IpcClient } from "@/ipc/ipc_client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Globe,
  Users,
  Shield,
  Zap,
  MessageSquare,
  ArrowRightLeft,
  Wallet,
  Key,
  Network,
  HardDrive,
  TrendingUp,
  ShoppingCart,
  RefreshCw,
  Search,
  Plus,
  Send,
  Lock,
  CheckCircle2,
  XCircle,
  Clock,
  Star,
  ExternalLink,
  Copy,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import type {
  DecentralizedIdentity,
  Peer,
  P2PListing,
  P2PTransaction,
  P2PConversation,
  FederationStats,
} from "@/types/federation_types";

const ipcClient = IpcClient.getInstance();

export default function FederationPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("network");
  const [showIdentityDialog, setShowIdentityDialog] = useState(false);
  const [showBuyDialog, setShowBuyDialog] = useState(false);
  const [selectedListing, setSelectedListing] = useState<P2PListing | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  
  // Identity form
  const [identityForm, setIdentityForm] = useState({
    displayName: "",
    password: "",
    confirmPassword: "",
  });

  // Queries
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

  const { data: connectedPeers = [] } = useQuery({
    queryKey: ["federation-connected-peers"],
    queryFn: () => FederationClient.getConnectedPeers(),
    refetchInterval: 10000,
  });

  const { data: listings = [], refetch: refetchListings } = useQuery({
    queryKey: ["federation-listings", searchQuery],
    queryFn: () => searchQuery 
      ? FederationClient.searchListings({ keyword: searchQuery })
      : FederationClient.getListings(),
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ["federation-transactions"],
    queryFn: () => FederationClient.getTransactions(),
  });

  const { data: conversations = [] } = useQuery({
    queryKey: ["federation-conversations"],
    queryFn: () => FederationClient.getConversations(),
    enabled: !!identity,
  });

  // Mutations
  const createIdentityMutation = useMutation({
    mutationFn: async () => {
      if (identityForm.password !== identityForm.confirmPassword) {
        throw new Error("Passwords do not match");
      }
      return FederationClient.createIdentity(identityForm.displayName, identityForm.password);
    },
    onSuccess: () => {
      toast.success("Identity created! Welcome to the federation.");
      queryClient.invalidateQueries({ queryKey: ["federation-identity"] });
      setShowIdentityDialog(false);
      setIdentityForm({ displayName: "", password: "", confirmPassword: "" });
    },
    onError: (error) => {
      toast.error(`Failed to create identity: ${error.message}`);
    },
  });

  const buyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedListing) throw new Error("No listing selected");
      // In production, would prompt for private key or use stored key
      return FederationClient.quickBuy(selectedListing.id, "demo-private-key", true);
    },
    onSuccess: (result) => {
      toast.success(`Transaction initiated! ID: ${result.transaction.id.slice(0, 12)}...`);
      queryClient.invalidateQueries({ queryKey: ["federation-transactions"] });
      setShowBuyDialog(false);
      setSelectedListing(null);
    },
    onError: (error) => {
      toast.error(`Transaction failed: ${error.message}`);
    },
  });

  const connectPeerMutation = useMutation({
    mutationFn: (peerId: string) => FederationClient.connectPeer(peerId),
    onSuccess: () => {
      toast.success("Connected to peer!");
      queryClient.invalidateQueries({ queryKey: ["federation-connected-peers"] });
    },
  });

  // Show identity creation if no identity
  useEffect(() => {
    if (!identityLoading && !identity) {
      setShowIdentityDialog(true);
    }
  }, [identity, identityLoading]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "online": return "bg-green-500";
      case "active": return "bg-green-500";
      case "completed": return "bg-blue-500";
      case "initiated": case "awaiting-payment": return "bg-yellow-500";
      case "disputed": return "bg-red-500";
      default: return "bg-gray-500";
    }
  };

  const getReputationColor = (score: number) => {
    if (score >= 90) return "text-green-500";
    if (score >= 70) return "text-yellow-500";
    return "text-red-500";
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Globe className="w-6 h-6 text-cyan-500" />
              Federation Network
            </h1>
            <p className="text-muted-foreground text-sm">
              Decentralized peer-to-peer marketplace • All users are peers
            </p>
          </div>
          <div className="flex items-center gap-3">
            {identity ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg">
                <Avatar className="w-6 h-6">
                  <AvatarFallback className="text-xs">
                    {identity.display_name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="text-sm">
                  <p className="font-medium">{identity.display_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {identity.did.slice(0, 20)}...
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(identity.did)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <Button onClick={() => setShowIdentityDialog(true)}>
                <Key className="w-4 h-4 mr-2" />
                Create Identity
              </Button>
            )}
            <Button variant="outline" onClick={() => refetchListings()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Network Stats Banner */}
      <div className="grid grid-cols-6 gap-4 p-4 bg-muted/30">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-cyan-500" />
          <div>
            <p className="text-xs text-muted-foreground">Peers</p>
            <p className="font-bold">{stats?.online_peers || 0}/{stats?.total_peers || 0}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-purple-500" />
          <div>
            <p className="text-xs text-muted-foreground">Storage</p>
            <p className="font-bold">{stats?.total_storage_tb?.toFixed(1) || 0} TB</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ShoppingCart className="w-5 h-5 text-green-500" />
          <div>
            <p className="text-xs text-muted-foreground">Listings</p>
            <p className="font-bold">{stats?.active_listings || 0}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-blue-500" />
          <div>
            <p className="text-xs text-muted-foreground">Transactions</p>
            <p className="font-bold">{stats?.total_transactions || 0}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-yellow-500" />
          <div>
            <p className="text-xs text-muted-foreground">Volume</p>
            <p className="font-bold">${stats?.total_volume_usd?.toFixed(0) || 0}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-emerald-500" />
          <div>
            <p className="text-xs text-muted-foreground">Health</p>
            <Badge 
              variant={stats?.network_health === "excellent" ? "default" : "secondary"}
              className="capitalize"
            >
              {stats?.network_health || "unknown"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="border-b px-4">
            <TabsList className="h-12">
              <TabsTrigger value="network" className="gap-2">
                <Network className="w-4 h-4" />
                Network
              </TabsTrigger>
              <TabsTrigger value="marketplace" className="gap-2">
                <ShoppingCart className="w-4 h-4" />
                Marketplace
              </TabsTrigger>
              <TabsTrigger value="transactions" className="gap-2">
                <ArrowRightLeft className="w-4 h-4" />
                Transactions
              </TabsTrigger>
              <TabsTrigger value="messages" className="gap-2">
                <MessageSquare className="w-4 h-4" />
                Messages
                {conversations.reduce((sum, c) => sum + c.unread_count, 0) > 0 && (
                  <Badge variant="destructive" className="ml-1 h-5 px-1.5">
                    {conversations.reduce((sum, c) => sum + c.unread_count, 0)}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="wallet" className="gap-2">
                <Wallet className="w-4 h-4" />
                Wallet
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-auto p-4">
            {/* Network Tab */}
            <TabsContent value="network" className="mt-0 h-full">
              <div className="grid grid-cols-3 gap-4 h-full">
                {/* Connected Peers */}
                <Card className="col-span-2">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      Connected Peers
                    </CardTitle>
                    <CardDescription>
                      Active connections in the federation network
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {connectedPeers.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Network className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>No peers connected yet</p>
                        <p className="text-sm">Connect to peers to join the network</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {connectedPeers.map((peer) => (
                          <div
                            key={peer.id}
                            className="flex items-center justify-between p-3 border rounded-lg"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar>
                                <AvatarFallback>
                                  {peer.did.display_name?.slice(0, 2).toUpperCase() || "??"}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="font-medium">{peer.did.display_name}</p>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {peer.id.slice(0, 16)}...
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right text-sm">
                                <p className={getReputationColor(peer.reputation.score)}>
                                  ★ {peer.reputation.score}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {peer.latency_ms}ms
                                </p>
                              </div>
                              <Badge className={`${getStatusColor(peer.status)} text-white`}>
                                {peer.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Known Peers */}
                <Card>
                  <CardHeader>
                    <CardTitle>Discover Peers</CardTitle>
                    <CardDescription>
                      Known peers in the network
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[400px]">
                      {peers.filter(p => !p.connected).map((peer) => (
                        <div
                          key={peer.id}
                          className="flex items-center justify-between p-2 hover:bg-muted rounded"
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${getStatusColor(peer.status)}`} />
                            <span className="text-sm truncate max-w-[120px]">
                              {peer.did.display_name || peer.id.slice(0, 12)}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => connectPeerMutation.mutate(peer.id)}
                          >
                            Connect
                          </Button>
                        </div>
                      ))}
                      {peers.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No peers discovered yet
                        </p>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Marketplace Tab */}
            <TabsContent value="marketplace" className="mt-0">
              <div className="space-y-4">
                {/* Search */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Search assets, creators, categories..."
                      className="pl-10"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <Select>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      <SelectItem value="dataset">Datasets</SelectItem>
                      <SelectItem value="model">Models</SelectItem>
                      <SelectItem value="agent">Agents</SelectItem>
                      <SelectItem value="prompt">Prompts</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue placeholder="Sort" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recent">Most Recent</SelectItem>
                      <SelectItem value="price-low">Price: Low</SelectItem>
                      <SelectItem value="price-high">Price: High</SelectItem>
                      <SelectItem value="popular">Popular</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Listings Grid */}
                {listings.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center h-64">
                      <ShoppingCart className="w-12 h-12 text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium">No Listings Found</h3>
                      <p className="text-muted-foreground text-sm">
                        Be the first to list an asset on the network
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    {listings.map((listing) => (
                      <Card key={listing.id} className="hover:border-cyan-500 transition-colors">
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between">
                            <Badge variant="outline">{listing.asset_id.split("-")[0]}</Badge>
                            <Badge className={`${getStatusColor(listing.status)} text-white`}>
                              {listing.status}
                            </Badge>
                          </div>
                          <CardTitle className="text-base truncate">
                            Asset #{listing.asset_id.slice(-8)}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {/* Seller Info */}
                          <div className="flex items-center gap-2">
                            <Avatar className="w-6 h-6">
                              <AvatarFallback className="text-xs">
                                {listing.seller.display_name.slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm">{listing.seller.display_name}</span>
                            <span className={`text-xs ${getReputationColor(listing.seller.reputation_score)}`}>
                              ★ {listing.seller.reputation_score}
                            </span>
                          </div>
                          
                          {/* Pricing */}
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground text-sm">Price</span>
                            <span className="font-bold">
                              {listing.pricing.base_price || 0} {listing.pricing.preferred_currency.symbol}
                            </span>
                          </div>
                          
                          {/* License */}
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">License</span>
                            <span className="capitalize">{listing.license.type}</span>
                          </div>
                          
                          {/* Delivery */}
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Delivery</span>
                            <Badge variant="outline" className="capitalize">
                              {listing.availability}
                            </Badge>
                          </div>
                        </CardContent>
                        <CardFooter className="gap-2">
                          <Button
                            className="flex-1"
                            onClick={() => {
                              setSelectedListing(listing);
                              setShowBuyDialog(true);
                            }}
                          >
                            <ShoppingCart className="w-4 h-4 mr-2" />
                            Buy
                          </Button>
                          <Button variant="outline" size="icon">
                            <MessageSquare className="w-4 h-4" />
                          </Button>
                        </CardFooter>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Transactions Tab */}
            <TabsContent value="transactions" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Transaction History</CardTitle>
                  <CardDescription>
                    Your P2P transactions with escrow protection
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {transactions.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <ArrowRightLeft className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No transactions yet</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Counterparty</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transactions.map((tx) => (
                          <TableRow key={tx.id}>
                            <TableCell className="font-mono text-xs">
                              {tx.id.slice(0, 12)}...
                            </TableCell>
                            <TableCell className="capitalize">{tx.type}</TableCell>
                            <TableCell>
                              {identity?.did === tx.buyer.did 
                                ? tx.seller.display_name 
                                : tx.buyer.display_name}
                            </TableCell>
                            <TableCell>
                              {tx.amount} {tx.currency.symbol}
                            </TableCell>
                            <TableCell>
                              <Badge className={`${getStatusColor(tx.status)} text-white`}>
                                {tx.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm">
                              {new Date(tx.initiated_at).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm">
                                <Eye className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Messages Tab */}
            <TabsContent value="messages" className="mt-0 h-full">
              <div className="grid grid-cols-3 gap-4 h-[600px]">
                {/* Conversations List */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Conversations</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[500px]">
                      {conversations.map((conv) => (
                        <div
                          key={conv.id}
                          className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-muted ${
                            selectedConversation === conv.id ? "bg-muted" : ""
                          }`}
                          onClick={() => setSelectedConversation(conv.id)}
                        >
                          <Avatar>
                            <AvatarFallback>
                              {conv.participants.find(p => p !== identity?.did)?.slice(-4) || "??"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              Peer {conv.participants.find(p => p !== identity?.did)?.slice(-8)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(conv.last_message_at).toLocaleString()}
                            </p>
                          </div>
                          {conv.unread_count > 0 && (
                            <Badge variant="destructive">{conv.unread_count}</Badge>
                          )}
                        </div>
                      ))}
                      {conversations.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-8">
                          No conversations yet
                        </p>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>

                {/* Message Thread */}
                <Card className="col-span-2">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {selectedConversation ? "Messages" : "Select a conversation"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="h-[440px] flex flex-col">
                    <ScrollArea className="flex-1 mb-4">
                      {selectedConversation ? (
                        <div className="space-y-4">
                          {/* Messages would render here */}
                          <p className="text-center text-muted-foreground text-sm py-8">
                            End-to-end encrypted messages
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                          <Lock className="w-8 h-8 mr-2" />
                          Select a conversation to view messages
                        </div>
                      )}
                    </ScrollArea>
                    {selectedConversation && (
                      <div className="flex gap-2">
                        <Input
                          placeholder="Type a message..."
                          value={messageInput}
                          onChange={(e) => setMessageInput(e.target.value)}
                        />
                        <Button>
                          <Send className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Wallet Tab */}
            <TabsContent value="wallet" className="mt-0">
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Balances</CardTitle>
                    <CardDescription>Your cryptocurrency balances</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center text-white font-bold">
                          J
                        </div>
                        <div>
                          <p className="font-medium">JOY Token</p>
                          <p className="text-xs text-muted-foreground">Native currency</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">0.00 JOY</p>
                        <p className="text-xs text-muted-foreground">$0.00</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                          Ξ
                        </div>
                        <div>
                          <p className="font-medium">Ethereum</p>
                          <p className="text-xs text-muted-foreground">ETH</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">0.00 ETH</p>
                        <p className="text-xs text-muted-foreground">$0.00</p>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button className="w-full">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Funds
                    </Button>
                  </CardFooter>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Escrow</CardTitle>
                    <CardDescription>Funds held in escrow for active transactions</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-center py-8">
                      <Lock className="w-12 h-12 mx-auto mb-2 text-muted-foreground opacity-50" />
                      <p className="text-2xl font-bold">$0.00</p>
                      <p className="text-sm text-muted-foreground">No funds in escrow</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Identity Creation Dialog */}
      <Dialog open={showIdentityDialog} onOpenChange={setShowIdentityDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              Create Your Identity
            </DialogTitle>
            <DialogDescription>
              Create a decentralized identity to join the federation network. 
              Your identity is self-sovereign - only you control it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                placeholder="How others will see you"
                value={identityForm.displayName}
                onChange={(e) => setIdentityForm({ ...identityForm, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                placeholder="Encrypts your private key"
                value={identityForm.password}
                onChange={(e) => setIdentityForm({ ...identityForm, password: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Confirm Password</Label>
              <Input
                type="password"
                placeholder="Confirm your password"
                value={identityForm.confirmPassword}
                onChange={(e) => setIdentityForm({ ...identityForm, confirmPassword: e.target.value })}
              />
            </div>

            <div className="bg-muted p-3 rounded-lg text-sm">
              <p className="font-medium mb-1">🔐 Important</p>
              <p className="text-muted-foreground">
                Your private key will be encrypted with this password. 
                If you lose your password, you cannot recover your identity.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => createIdentityMutation.mutate()}
              disabled={!identityForm.displayName || !identityForm.password || createIdentityMutation.isPending}
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

      {/* Buy Dialog */}
      <Dialog open={showBuyDialog} onOpenChange={setShowBuyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Purchase Asset</DialogTitle>
            <DialogDescription>
              Review the listing details before purchasing
            </DialogDescription>
          </DialogHeader>

          {selectedListing && (
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Seller</span>
                <div className="flex items-center gap-2">
                  <span>{selectedListing.seller.display_name}</span>
                  <span className={getReputationColor(selectedListing.seller.reputation_score)}>
                    ★ {selectedListing.seller.reputation_score}
                  </span>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Price</span>
                <span className="font-bold text-lg">
                  {selectedListing.pricing.base_price} {selectedListing.pricing.preferred_currency.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">License</span>
                <span className="capitalize">{selectedListing.license.type}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Delivery</span>
                <span className="capitalize">{selectedListing.delivery_method}</span>
              </div>
              <Separator />
              <div className="bg-muted p-3 rounded-lg">
                <div className="flex items-center gap-2 text-sm">
                  <Lock className="w-4 h-4 text-green-500" />
                  <span>Protected by escrow</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Funds are held securely until you confirm delivery
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBuyDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => buyMutation.mutate()} disabled={buyMutation.isPending}>
              {buyMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  Confirm Purchase
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
