/**
 * Federation Page — Instance-to-instance networking
 *
 * Manage federated JoyCreate instances, peer discovery,
 * shared agent networks, cross-instance marketplace, and
 * federated identity resolution.
 *
 * Tabs:
 * 1. Peers — connected instances and discovery
 * 2. Shared Agents — agents available from peers
 * 3. Shared Assets — marketplace items from federation
 * 4. Identity — cross-instance identity resolution
 * 5. Settings — federation config, allowlists, policies
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  Globe, Network, Server, Bot, Package, Fingerprint,
  Settings, Search, Plus, RefreshCw, CheckCircle2, XCircle,
  Shield, Wifi, WifiOff, ArrowUpDown, Link, Unlink,
  Eye, Users, Activity, Zap, Lock, Unlock,
} from "lucide-react";

interface FederationPeer {
  id: string;
  name: string;
  url: string;
  status: "connected" | "disconnected" | "pending";
  agents: number;
  assets: number;
  latency: number;
  lastSeen: string;
  trusted: boolean;
  version: string;
}

const MOCK_PEERS: FederationPeer[] = [
  { id: "1", name: "JoyCreate Cloud", url: "https://cloud.joycreate.app", status: "connected", agents: 47, assets: 312, latency: 42, lastSeen: new Date().toISOString(), trusted: true, version: "2.4.0" },
  { id: "2", name: "Community Hub", url: "https://community.joycreate.dev", status: "connected", agents: 23, assets: 89, latency: 78, lastSeen: new Date().toISOString(), trusted: true, version: "2.3.8" },
  { id: "3", name: "Enterprise Node (ACME Corp)", url: "https://joy.acme.internal", status: "disconnected", agents: 12, assets: 34, latency: 0, lastSeen: new Date(Date.now() - 86400000).toISOString(), trusted: false, version: "2.2.1" },
  { id: "4", name: "Research Lab", url: "https://ml.university.edu/joy", status: "pending", agents: 8, assets: 15, latency: 0, lastSeen: new Date(Date.now() - 172800000).toISOString(), trusted: false, version: "2.4.0" },
];

function PeerCard({ peer }: { peer: FederationPeer }) {
  const statusConfig = {
    connected: { icon: <CheckCircle2 className="w-4 h-4" />, color: "text-green-400", bg: "bg-green-500/10" },
    disconnected: { icon: <XCircle className="w-4 h-4" />, color: "text-red-400", bg: "bg-red-500/10" },
    pending: { icon: <RefreshCw className="w-4 h-4 animate-spin" />, color: "text-amber-400", bg: "bg-amber-500/10" },
  };
  const sc = statusConfig[peer.status];

  return (
    <Card className="bg-muted/10 border-border/30">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl ${sc.bg} flex items-center justify-center ${sc.color}`}>
            <Server className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium truncate">{peer.name}</h4>
              {peer.trusted && <Badge className="bg-blue-500/20 text-blue-400 text-[9px]"><Shield className="w-2.5 h-2.5 mr-0.5" /> Trusted</Badge>}
            </div>
            <p className="text-[10px] text-muted-foreground/50 font-mono truncate">{peer.url}</p>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[10px] text-muted-foreground/60"><Bot className="w-3 h-3 inline mr-0.5" />{peer.agents} agents</span>
              <span className="text-[10px] text-muted-foreground/60"><Package className="w-3 h-3 inline mr-0.5" />{peer.assets} assets</span>
              {peer.status === "connected" && <span className="text-[10px] text-muted-foreground/60">{peer.latency}ms</span>}
              <span className="text-[10px] text-muted-foreground/40">v{peer.version}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge className={`${sc.bg} ${sc.color} text-[9px]`}>{sc.icon}<span className="ml-0.5 capitalize">{peer.status}</span></Badge>
            {peer.status === "connected" ? (
              <Button variant="ghost" size="sm" className="h-7 text-[10px]"><Unlink className="w-3 h-3 mr-0.5" /> Disconnect</Button>
            ) : (
              <Button variant="outline" size="sm" className="h-7 text-[10px]"><Link className="w-3 h-3 mr-0.5" /> Connect</Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SharedAgentsTab() {
  const sharedAgents = [
    { name: "Code Review Bot", source: "JoyCreate Cloud", rating: 4.8, uses: 12400, type: "task" },
    { name: "Data Analyst", source: "Community Hub", rating: 4.5, uses: 8700, type: "rag" },
    { name: "Content Writer", source: "JoyCreate Cloud", rating: 4.6, uses: 15200, type: "chatbot" },
    { name: "Security Scanner", source: "Community Hub", rating: 4.9, uses: 3400, type: "task" },
    { name: "API Tester", source: "JoyCreate Cloud", rating: 4.3, uses: 6100, type: "workflow" },
  ];

  return (
    <div className="space-y-2">
      {sharedAgents.map((agent) => (
        <Card key={agent.name} className="bg-muted/10 border-border/30">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Bot className="w-5 h-5 text-violet-400" />
            </div>
            <div className="flex-1">
              <span className="text-sm font-medium">{agent.name}</span>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="outline" className="text-[9px] capitalize">{agent.type}</Badge>
                <span className="text-[10px] text-muted-foreground/50">from {agent.source}</span>
                <span className="text-[10px] text-amber-400">★ {agent.rating}</span>
                <span className="text-[10px] text-muted-foreground/40">{agent.uses.toLocaleString()} uses</span>
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-[10px]"><Plus className="w-3 h-3 mr-0.5" /> Install</Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FederationSettingsTab() {
  return (
    <div className="space-y-6 max-w-2xl">
      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Federation Mode</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <div><Label className="text-xs">Enable Federation</Label><p className="text-[10px] text-muted-foreground/50">Allow peer discovery and connections</p></div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div><Label className="text-xs">Auto-Accept Trusted Peers</Label><p className="text-[10px] text-muted-foreground/50">Skip approval for known instances</p></div>
            <Switch />
          </div>
          <div className="flex items-center justify-between">
            <div><Label className="text-xs">Share Agent Catalog</Label><p className="text-[10px] text-muted-foreground/50">Make your published agents discoverable</p></div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div><Label className="text-xs">Share Marketplace Assets</Label><p className="text-[10px] text-muted-foreground/50">Federate your marketplace listings</p></div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div><Label className="text-xs">Cross-Instance Identity</Label><p className="text-[10px] text-muted-foreground/50">Resolve DID/ENS across peers</p></div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/10 border-border/30">
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">Instance Identity</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div><Label className="text-xs">Instance Name</Label><Input defaultValue="Terry's JoyCreate" className="mt-1" /></div>
          <div><Label className="text-xs">Public URL</Label><Input defaultValue="https://joy.terrybuild.com" className="mt-1" /></div>
          <div><Label className="text-xs">Instance DID</Label><Input defaultValue="did:joy:zQ3shN...kX7v" className="mt-1" readOnly /></div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function FederationPage() {
  const [activeTab, setActiveTab] = useState("peers");

  return (
    <div className="h-full flex flex-col">
      <div className="border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Network className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Federation</h1>
              <p className="text-sm text-muted-foreground">{MOCK_PEERS.filter(p => p.status === "connected").length} peers connected • {MOCK_PEERS.reduce((a, p) => a + p.agents, 0)} agents available</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm"><RefreshCw className="w-3.5 h-3.5 mr-1" /> Discover Peers</Button>
            <Button size="sm"><Plus className="w-3.5 h-3.5 mr-1" /> Add Peer</Button>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="border-b px-4">
          <TabsList className="bg-transparent">
            <TabsTrigger value="peers" className="gap-1.5"><Server className="w-3.5 h-3.5" /> Peers</TabsTrigger>
            <TabsTrigger value="shared-agents" className="gap-1.5"><Bot className="w-3.5 h-3.5" /> Shared Agents</TabsTrigger>
            <TabsTrigger value="shared-assets" className="gap-1.5"><Package className="w-3.5 h-3.5" /> Shared Assets</TabsTrigger>
            <TabsTrigger value="identity" className="gap-1.5"><Fingerprint className="w-3.5 h-3.5" /> Identity</TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5"><Settings className="w-3.5 h-3.5" /> Settings</TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="flex-1 p-4">
          <TabsContent value="peers" className="mt-0 space-y-2">
            {MOCK_PEERS.map(peer => <PeerCard key={peer.id} peer={peer} />)}
          </TabsContent>
          <TabsContent value="shared-agents" className="mt-0"><SharedAgentsTab /></TabsContent>
          <TabsContent value="shared-assets" className="mt-0">
            <div className="text-center py-12 text-muted-foreground/50">
              <Package className="w-10 h-10 mx-auto mb-3" />
              <p className="text-sm">Connect to peers to browse shared marketplace assets</p>
            </div>
          </TabsContent>
          <TabsContent value="identity" className="mt-0">
            <Card className="bg-muted/10 border-border/30 mb-4">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-2">Cross-Instance Identity Resolution</h3>
                <p className="text-xs text-muted-foreground/60 mb-3">Resolve identities (DID, ENS, JNS) across federated peers. Your identity is portable — recognized everywhere.</p>
                <div className="flex items-center gap-2">
                  <Input placeholder="Enter DID, ENS, or JNS name to resolve..." className="flex-1 h-8 text-xs" />
                  <Button size="sm" className="h-8"><Search className="w-3.5 h-3.5 mr-1" /> Resolve</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="settings" className="mt-0"><FederationSettingsTab /></TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
